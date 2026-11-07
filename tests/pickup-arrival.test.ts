import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceArrival, scheduleArrivalReload, type ArrivalState } from "../src/lib/pickup-arrival";
import type { Position } from "../src/lib/domain";
import { PICKUP_STOPS, type PickupSelection, type RoadRoute } from "../src/lib/pickups";

const now = Date.UTC(2026, 10, 7);
const stop = PICKUP_STOPS[0];
const selection: PickupSelection = { stopId: "talat-phlu", source: "manual", revision: 1 };
const route: RoadRoute = {
  points: [[stop.latitude + 0.01, stop.longitude], [stop.latitude, stop.longitude]], distanceMeters: 1000, durationSeconds: 780,
  vehicleId: "SHUTTLE-01", stopId: "talat-phlu", sourceRevision: 1,
  fetchedAt: new Date(now).toISOString(), trafficAware: true, provider: "tomtom",
};
const fix: Position = {
  vehicle_id: "SHUTTLE-01", revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1,
  latitude: stop.latitude, longitude: stop.longitude, accuracy_meters: 5, speed_meters_per_second: 10, bearing_degrees: 90,
  captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString(),
};
const watching: ArrivalState = { key: null, kind: "watching" };
function step(state = watching, elapsed = 0, patch: Partial<Position> = {}, road: RoadRoute | null = route, chosen: PickupSelection | null = selection) {
  const time = now + elapsed;
  return advanceArrival({ state, vehicleId: "SHUTTLE-01", selection: chosen, position: {
    ...fix, revision: elapsed + 1, captured_at: new Date(time).toISOString(), received_at: new Date(time).toISOString(), ...patch,
  }, route: road, now: time, demo: false });
}

test("arrival needs independent GPS timestamps spanning two seconds and latches one absolute reload deadline", () => {
  const first = step();
  assert.deepEqual(first, { key: "SHUTTLE-01:talat-phlu:1", kind: "confirming", firstCapturedAt: now, lastCapturedAt: now });
  assert.deepEqual(step(first, 1000, { captured_at: fix.captured_at }), first);
  const second = step(first, 1000);
  assert.equal(second.kind, "confirming");
  const arrived = step(second, 2000);
  assert.deepEqual(arrived, { key: "SHUTTLE-01:talat-phlu:1", kind: "arrived", reloadAt: now + 62000 });
  assert.deepEqual(step(arrived, 20000, { latitude: stop.latitude + 0.01 }), arrived);
  assert.deepEqual(advanceArrival({ state: arrived, vehicleId: "SHUTTLE-01", selection, position: null, route: null, now: now + 30000, demo: false }), arrived);
});

test("moving and stationary buses qualify without a speed requirement", () => {
  for (const speed_meters_per_second of [null, 0, 15]) {
    const arrived = step(step(watching, 0, { speed_meters_per_second }), 2000, { speed_meters_per_second });
    assert.deepEqual(arrived, { key: "SHUTTLE-01:talat-phlu:1", kind: "arrived", reloadAt: now + 62000 });
  }
});

test("geofence uncertainty and unrounded road distance must both be within fifty metres", () => {
  const metresPerDegree = 6371000 * Math.PI / 180;
  for (const [distance, accuracy, qualifies] of [[40, 9, true], [40, 11, false], [0, 50, true], [0, 50.01, false], [49, 5, false]] satisfies [number, number, boolean][]) {
    const result = step(watching, 0, { latitude: stop.latitude + distance / metresPerDegree, accuracy_meters: accuracy });
    assert.equal(result.kind, qualifies ? "confirming" : "watching");
  }
  const road: RoadRoute = { ...route, distanceMeters: 10000 };
  assert.equal(step(watching, 0, { latitude: stop.latitude + 20 / metresPerDegree }, road).kind, "watching");
  assert.equal(step(watching, 0, { latitude: stop.latitude + 20 / metresPerDegree }).kind, "confirming");
});

test("stale, inaccurate, future and mismatched fixes cannot confirm arrival", () => {
  const candidate = step();
  for (const patch of [
    { accuracy_meters: null }, { accuracy_meters: 51 }, { vehicle_id: "SHUTTLE-02" } satisfies Partial<Position>,
    { captured_at: new Date(now - 10001).toISOString() }, { received_at: new Date(now - 10001).toISOString() },
    { captured_at: new Date(now + 5001).toISOString() }, { latitude: stop.latitude + 0.001 },
  ]) assert.equal(step(candidate, 0, patch).kind, "watching");
  for (const road of [null, { ...route, vehicleId: "SHUTTLE-02" } satisfies RoadRoute, { ...route, stopId: "tha-phra" } satisfies RoadRoute]) {
    assert.equal(step(candidate, 2000, {}, road).kind, "watching");
  }
});

test("ambiguous overlapping geometry cannot prove arrival and a GPS gap restarts confirmation", () => {
  const loop: RoadRoute = { ...route, points: [[stop.latitude, stop.longitude], [stop.latitude + 0.01, stop.longitude], [stop.latitude, stop.longitude]] };
  assert.equal(step(watching, 0, {}, loop).kind, "watching");
  const restarted = step(step(), 11000);
  assert.deepEqual(restarted, { key: "SHUTTLE-01:talat-phlu:1", kind: "confirming", firstCapturedAt: now + 11000, lastCapturedAt: now + 11000 });
  assert.equal(step(restarted, 13000).kind, "arrived");
});

test("leaving before confirmation resets evidence and selection or vehicle change clears a latched event", () => {
  const left = step(step(), 1000, { latitude: stop.latitude + 0.01 });
  assert.equal(left.kind, "watching");
  assert.equal(step(left, 2000).kind, "confirming");
  const arrived = step(step(), 2000);
  assert.equal(step(arrived, 3000, {}, route, { ...selection, revision: 2 }).kind, "confirming");
  assert.equal(step(arrived, 3000, {}, route, { ...selection, stopId: "tha-phra", revision: 2 }).kind, "watching");
  assert.equal(step(arrived, 3000, {}, route, null).kind, "watching");
  assert.equal(advanceArrival({ state: arrived, vehicleId: "SHUTTLE-02", selection, position: fix, route, now, demo: false }).kind, "watching");
  assert.equal(advanceArrival({ state: arrived, vehicleId: "SHUTTLE-01", selection, position: fix, route, now, demo: true }).kind, "watching");
});

function clock() {
  let time = 0;
  let timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let visible: (() => void) | null = null;
  const events: string[] = [];
  const cancel = scheduleArrivalReload({
    reloadAt: 60000, now: () => time,
    schedule: (callback, delay) => { timers.set(++timerId, { at: time + delay, callback }); return timerId; },
    cancel: id => { timers.delete(id); }, onFade: () => events.push(`fade:${time}`), onReload: () => events.push(`reload:${time}`),
    onVisible: callback => { visible = callback; return () => { visible = null; }; },
  });
  return {
    events, cancel,
    tick(next: number) {
      while (true) {
        const entry = [...timers.entries()].filter(([, value]) => value.at <= next).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        timers.delete(entry[0]); time = entry[1].at; entry[1].callback();
      }
      time = next;
    },
    resume(next: number) { time = next; visible?.(); },
  };
}

test("reload scheduler fades just before the minute deadline and reloads exactly once", () => {
  const timer = clock();
  timer.tick(59819);
  assert.deepEqual(timer.events, []);
  timer.tick(59820);
  assert.deepEqual(timer.events, ["fade:59820"]);
  timer.tick(59999);
  assert.deepEqual(timer.events, ["fade:59820"]);
  timer.tick(60000);
  timer.resume(61000);
  assert.deepEqual(timer.events, ["fade:59820", "reload:60000"]);
});

test("overdue visibility reloads once and cleanup cancels timers and visibility handling", () => {
  const overdue = clock();
  overdue.resume(70000);
  overdue.resume(80000);
  assert.deepEqual(overdue.events, ["reload:70000"]);
  const cancelled = clock();
  cancelled.cancel();
  cancelled.tick(70000);
  cancelled.resume(80000);
  assert.deepEqual(cancelled.events, []);
  const normal = clock();
  normal.tick(60000);
  assert.deepEqual(normal.events, ["fade:59820", "reload:60000"]);
});


test("an early timer wake-up is rearmed instead of leaving the page without a reload", () => {
  let time = 0;
  let id = 0;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  const events: string[] = [];
  const dispose = scheduleArrivalReload({
    reloadAt: 60000, now: () => time,
    schedule: (callback, delay) => { callbacks.set(++id, callback); delays.push(delay); return id; },
    cancel: timer => { callbacks.delete(timer); },
    onFade: () => events.push("fade"), onReload: () => events.push("reload"), onVisible: () => () => {},
  });
  const firstReload = callbacks.get(2);
  if (!firstReload) throw new Error("Expected initial reload timer");
  time = 30000;
  firstReload();
  assert.equal(delays.at(-1), 30000);
  assert.deepEqual(events, []);
  time = 60000;
  const retry = callbacks.get(3);
  if (!retry) throw new Error("Expected rearmed reload timer");
  retry();
  firstReload();
  assert.deepEqual(events, ["reload"]);
  dispose();
});
