import { test } from "node:test";
import assert from "node:assert/strict";
import { PickupRouteCache, RouteUnavailableError, type RoutePair } from "../src/lib/pickup-route-cache";
import type { RoadRoute } from "../src/lib/pickups";

const bts: RoutePair = { vehicleId: "SHUTTLE-01", stopId: "talat-phlu" };
const mrt: RoutePair = { vehicleId: "SHUTTLE-01", stopId: "tha-phra" };
const otherVehicle: RoutePair = { vehicleId: "SHUTTLE-02", stopId: "talat-phlu" };

function route(pair: RoutePair): RoadRoute {
  return {
    ...pair, points: [[13.72, 100.47], [13.73, 100.47]],
    durationSeconds: 600, distanceMeters: 1000, fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceRevision: 1, trafficAware: true, provider: "tomtom",
  };
}

test("concurrent requests for the same vehicle and stop share one load", async () => {
  let calls = 0;
  const deferred = Promise.withResolvers<RoadRoute>();
  const cache = new PickupRouteCache(() => { calls++; return deferred.promise; });
  const first = cache.load(bts);
  const second = cache.load(bts);
  assert.equal(first, second);
  assert.deepEqual(cache.get(bts), { kind: "loading", previousRoute: null });
  await Promise.resolve();
  assert.equal(calls, 1);
  deferred.resolve(route(bts));
  await first;
  assert.deepEqual(cache.get(bts), { kind: "ready", route: route(bts) });
});

test("switching stops and vehicles preserves each successful route without fetching again", async () => {
  const calls: RoutePair[] = [];
  const cache = new PickupRouteCache(async (pair) => { calls.push(pair); return route(pair); });
  await cache.load(bts);
  await cache.load(mrt);
  await cache.load(otherVehicle);
  await cache.load(bts);
  await cache.load(mrt);
  assert.deepEqual(calls, [bts, mrt, otherVehicle]);
  assert.deepEqual(cache.get(bts), { kind: "ready", route: route(bts) });
  assert.deepEqual(cache.get(otherVehicle), { kind: "ready", route: route(otherVehicle) });
});

test("a pending old selection still completes and stays cached while another selection loads", async () => {
  const deferred = Promise.withResolvers<RoadRoute>();
  let calls = 0;
  const cache = new PickupRouteCache((pair) => {
    calls++;
    return pair.stopId === "talat-phlu" ? deferred.promise : Promise.resolve(route(pair));
  });
  const first = cache.load(bts);
  await cache.load(mrt);
  deferred.resolve(route(bts));
  await first;
  await cache.load(bts);
  assert.equal(calls, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", route: route(bts) });
  assert.deepEqual(cache.get(mrt), { kind: "ready", route: route(mrt) });
});

test("a failure stays visible without automatic retries, and explicit retry can recover", async () => {
  let calls = 0;
  const cache = new PickupRouteCache(async (pair) => {
    calls++;
    if (calls === 1) throw new Error("โหลดเส้นทางไม่ได้ กรุณาลองใหม่");
    return route(pair);
  });
  await cache.load(bts);
  await cache.load(bts);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get(bts), { kind: "error", previousRoute: null, message: "โหลดเส้นทางไม่ได้ กรุณาลองใหม่" });
  await cache.retry(bts);
  assert.equal(calls, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", route: route(bts) });
});

test("explicit refresh of a ready route is deduplicated while loading", async () => {
  let calls = 0;
  const deferred = Promise.withResolvers<RoadRoute>();
  const cache = new PickupRouteCache(async (pair) => {
    calls++;
    return calls === 1 ? route(pair) : deferred.promise;
  });
  await cache.load(bts);
  const refresh = cache.retry(bts);
  assert.deepEqual(cache.get(bts), { kind: "loading", previousRoute: route(bts) });
  assert.equal(cache.retry(bts), refresh);
  deferred.resolve(route(bts));
  await refresh;
  assert.equal(calls, 2);
});

test("a failed explicit refresh preserves the previous successful route", async () => {
  let calls = 0;
  const cache = new PickupRouteCache(async (pair) => {
    if (++calls > 1) throw new Error("โหลดเส้นทางไม่ได้ กรุณาลองใหม่");
    return route(pair);
  });
  await cache.load(bts);
  await cache.retry(bts);
  assert.deepEqual(cache.get(bts), {
    kind: "error", previousRoute: route(bts), message: "โหลดเส้นทางไม่ได้ กรุณาลองใหม่",
  });
  await cache.load(bts);
  assert.equal(calls, 2);
});

test("a mismatched response cannot enter the requested vehicle and stop cache", async () => {
  const cache = new PickupRouteCache(async () => route(mrt));
  await cache.load(bts);
  assert.deepEqual(cache.get(bts), { kind: "error", previousRoute: null, message: "ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก" });
  assert.equal(cache.get(mrt), undefined);
});


test("explicit refresh silently retries unavailable responses until ready and retains geometry", async () => {
  let calls = 0;
  let waits = 0;
  const cache = new PickupRouteCache(async (pair) => {
    calls++;
    if (calls > 1 && calls < 5) throw new RouteUnavailableError();
    return { ...route(pair), sourceRevision: calls };
  }, async () => {
    waits++;
    assert.deepEqual(cache.get(bts), { kind: "loading", previousRoute: route(bts) });
  });
  await cache.load(bts);
  const refresh = cache.retry(bts);
  assert.equal(cache.retry(bts), refresh);
  assert.equal(cache.load(bts), refresh);
  await refresh;
  assert.equal(calls, 5);
  assert.equal(waits, 3);
  assert.deepEqual(cache.get(bts), { kind: "ready", route: { ...route(bts), sourceRevision: 5 } });
});

test("initial unavailable load retries three times before caching the final error", async () => {
  let calls = 0;
  let waits = 0;
  const cache = new PickupRouteCache(async () => { calls++; throw new RouteUnavailableError(); }, async () => { waits++; });
  await cache.load(bts);
  await cache.load(bts);
  assert.equal(calls, 4);
  assert.equal(waits, 3);
  assert.equal(cache.get(bts)?.kind, "error");
});

test("leaving the page cancels an unavailable refresh without another request", async () => {
  let calls = 0;
  const waiting = Promise.withResolvers<void>();
  const cache = new PickupRouteCache(async () => { calls++; throw new RouteUnavailableError(); }, signal => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    waiting.resolve();
  }));
  const refresh = cache.retry(bts);
  await waiting.promise;
  cache.cancelRetries();
  await refresh;
  assert.equal(calls, 1);
  assert.equal(cache.get(bts)?.kind, "error");
});


test("refresh keeps skeleton state through all retries and only exposes the final error", async () => {
  let calls = 0;
  let waits = 0;
  let fail = false;
  const cache = new PickupRouteCache(async (pair) => {
    calls++;
    if (fail) throw new RouteUnavailableError();
    return route(pair);
  }, async () => {
    waits++;
    assert.deepEqual(cache.get(bts), { kind: "loading", previousRoute: route(bts) });
  });
  await cache.load(bts);
  fail = true;
  await cache.retry(bts);
  assert.equal(calls, 5);
  assert.equal(waits, 3);
  assert.deepEqual(cache.get(bts), { kind: "error", previousRoute: route(bts), message: "ยังไม่พร้อมแสดงเส้นทางและเวลาถึง" });
  await cache.load(bts);
  assert.equal(calls, 5);
});
