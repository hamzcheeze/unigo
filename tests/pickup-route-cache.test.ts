import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { PickupRouteCache, RouteUnavailableError, type RoutePair } from "../src/lib/pickup-route-cache";
import type { RoadRoute } from "../src/lib/pickups";

const now = Date.UTC(2026, 10, 7);
beforeEach(() => { mock.method(Date, "now", () => now); });
afterEach(() => { mock.restoreAll(); });

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
  assert.deepEqual(cache.get(bts), { kind: "loading", previousSnapshot: null });
  await Promise.resolve();
  assert.equal(calls, 1);
  deferred.resolve(route(bts));
  await first;
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
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
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
  assert.deepEqual(cache.get(otherVehicle), { kind: "ready", snapshot: { route: route(otherVehicle), receivedAt: now, speedMetersPerSecond: null } });
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
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
  assert.deepEqual(cache.get(mrt), { kind: "ready", snapshot: { route: route(mrt), receivedAt: now, speedMetersPerSecond: null } });
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
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "โหลดเส้นทางไม่ได้ กรุณาลองใหม่" });
  await cache.retry(bts);
  assert.equal(calls, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
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
  assert.deepEqual(cache.get(bts), { kind: "loading", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
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
    kind: "error", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null }, message: "โหลดเส้นทางไม่ได้ กรุณาลองใหม่",
  });
  await cache.load(bts);
  assert.equal(calls, 2);
});

test("a mismatched response cannot enter the requested vehicle and stop cache", async () => {
  const cache = new PickupRouteCache(async () => route(mrt));
  await cache.load(bts);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก" });
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
    assert.deepEqual(cache.get(bts), { kind: "loading", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
  });
  await cache.load(bts);
  const refresh = cache.retry(bts);
  assert.equal(cache.retry(bts), refresh);
  assert.equal(cache.load(bts), refresh);
  await refresh;
  assert.equal(calls, 5);
  assert.equal(waits, 3);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: { ...route(bts), sourceRevision: 5 }, receivedAt: now, speedMetersPerSecond: null } });
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
    assert.deepEqual(cache.get(bts), { kind: "loading", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
  });
  await cache.load(bts);
  fail = true;
  await cache.retry(bts);
  assert.equal(calls, 5);
  assert.equal(waits, 3);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null }, message: "ยังไม่พร้อมแสดงเส้นทางและเวลาถึง" });
  await cache.load(bts);
  assert.equal(calls, 5);
});

test("retry can initialize an unseen pair and stops as soon as a retry succeeds", async () => {
  let calls = 0;
  let waits = 0;
  const cache = new PickupRouteCache(async pair => {
    if (++calls === 1) throw new RouteUnavailableError();
    return route(pair);
  }, async () => { waits++; });
  await cache.retry(bts);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
  assert.equal(calls, 2);
  assert.equal(waits, 1);
});

test("synchronous and non-Error loader failures become visible errors without retries", async () => {
  const sync = new PickupRouteCache(() => { throw new Error("sync failure"); });
  await sync.load(bts);
  assert.deepEqual(sync.get(bts), { kind: "error", previousSnapshot: null, message: "sync failure" });
  const nonError = new PickupRouteCache(async () => { throw "offline"; });
  await nonError.load(bts);
  assert.deepEqual(nonError.get(bts), { kind: "error", previousSnapshot: null, message: "โหลดเส้นทางไม่ได้ กรุณาลองใหม่" });
});

test("wrong vehicle response is rejected even when its stop matches", async () => {
  const cache = new PickupRouteCache(async () => route(otherVehicle));
  await cache.load(bts);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก" });
  assert.equal(cache.get(otherVehicle), undefined);
});

test("failure of one pair does not prevent another pair from becoming ready", async () => {
  const cache = new PickupRouteCache(async pair => {
    if (pair.stopId === "talat-phlu") throw new Error("failed BTS");
    return route(pair);
  });
  await Promise.all([cache.load(bts), cache.load(mrt)]);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "failed BTS" });
  assert.deepEqual(cache.get(mrt), { kind: "ready", snapshot: { route: route(mrt), receivedAt: now, speedMetersPerSecond: null } });
});

test("cancelling before a pending load begins does not call the loader and explicit retry recovers", async () => {
  let calls = 0;
  const cache = new PickupRouteCache(async pair => { calls++; return route(pair); });
  const pending = cache.load(bts);
  cache.cancelRetries();
  await pending;
  assert.equal(calls, 0);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "หยุดการอัพเดตเส้นทางแล้ว" });
  await cache.retry(bts);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
});

test("a failed second refresh retains the last successful route for subsequent retries", async () => {
  let calls = 0;
  const previous = { ...route(bts), sourceRevision: 2 };
  const cache = new PickupRouteCache(async () => {
    if (++calls <= 2) return calls === 1 ? route(bts) : previous;
    throw new Error("refresh failure");
  });
  await cache.load(bts);
  await cache.retry(bts);
  await cache.retry(bts);
  await cache.retry(bts);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: { route: previous, receivedAt: now, speedMetersPerSecond: null }, message: "refresh failure" });
  assert.equal(calls, 4);
});

test("default retry waits the full thirty seconds before attempting again", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const cache = new PickupRouteCache(async pair => {
    if (++calls === 1) throw new RouteUnavailableError();
    return route(pair);
  });
  const pending = cache.load(bts);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(29999);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(cache.get(bts), { kind: "loading", previousSnapshot: null });
  t.mock.timers.tick(1);
  await pending;
  assert.equal(calls, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: null } });
});

test("cancelling the default retry timer stops another loader attempt", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const cache = new PickupRouteCache(async () => { calls++; throw new RouteUnavailableError(); });
  const pending = cache.load(bts);
  await new Promise<void>(resolve => setImmediate(resolve));
  cache.cancelRetries();
  await pending;
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "หยุดการอัพเดตเส้นทางแล้ว" });
});

test("cancellation during loader failure also rejects an already-aborted retry wait", async () => {
  let calls = 0;
  const cache = new PickupRouteCache(async () => {
    calls++;
    cache.cancelRetries();
    throw new RouteUnavailableError();
  });
  await cache.load(bts);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: null, message: "หยุดการอัพเดตเส้นทางแล้ว" });
});


test("receipt time starts after loading and only a successful refresh resets the countdown", async () => {
  let time = now;
  let fail = false;
  const deferred = Promise.withResolvers<RoadRoute>();
  let calls = 0;
  const cache = new PickupRouteCache(async pair => {
    calls++;
    if (fail) throw new Error("refresh failure");
    return calls === 1 ? deferred.promise : { ...route(pair), durationSeconds: 780 };
  }, undefined, () => time);
  const pending = cache.load(bts);
  time += 45000;
  deferred.resolve(route(bts));
  await pending;
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now + 45000, speedMetersPerSecond: null } });
  time += 120000;
  await cache.load(mrt);
  await cache.load(bts);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now + 45000, speedMetersPerSecond: null } });
  time += 60000;
  await cache.retry(bts);
  const refreshed = { route: { ...route(bts), durationSeconds: 780 }, receivedAt: now + 225000, speedMetersPerSecond: null };
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: refreshed });
  fail = true;
  time += 60000;
  await cache.retry(bts);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: refreshed, message: "refresh failure" });
});

test("speed is captured per pair and replaced only by a successful explicit refresh", async () => {
  let fail = false;
  const cache = new PickupRouteCache(async pair => {
    if (fail) throw new Error("refresh failed");
    return route(pair);
  });
  await cache.load(bts, 5);
  await cache.load(mrt, 10);
  await cache.load(bts, 20);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: 5 } });
  assert.deepEqual(cache.get(mrt), { kind: "ready", snapshot: { route: route(mrt), receivedAt: now, speedMetersPerSecond: 10 } });
  fail = true;
  await cache.retry(bts, 15);
  assert.deepEqual(cache.get(bts), { kind: "error", previousSnapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: 5 }, message: "refresh failed" });
  fail = false;
  await cache.retry(bts, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now, speedMetersPerSecond: 2 } });
});

test("coalesced requests and 503 retries keep speed captured when the request began", async () => {
  let calls = 0;
  let time = now;
  const wait = Promise.withResolvers<void>();
  const cache = new PickupRouteCache(async pair => {
    if (++calls === 1) throw new RouteUnavailableError();
    return route(pair);
  }, () => wait.promise, () => time);
  const request = cache.load(bts, 5);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cache.retry(bts, 25), request);
  time += 30000;
  wait.resolve();
  await request;
  assert.equal(calls, 2);
  assert.deepEqual(cache.get(bts), { kind: "ready", snapshot: { route: route(bts), receivedAt: now + 30000, speedMetersPerSecond: 5 } });
});
