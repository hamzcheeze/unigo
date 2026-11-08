import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "../src/lib/domain";
import { advanceRouteSignal, routeSignalGap, usableRoutePosition, type RouteSignal } from "../src/lib/route-signal";

const now = Date.parse("2026-11-08T00:00:00Z");
const vehicle = "SHUTTLE-01";
function fix(seconds: number, overrides: Partial<Position> = {}): Position {
  return {
    vehicle_id: vehicle, revision: seconds + 1, sequence: seconds + 1,
    session_id: "a0000000-0000-4000-8000-000000000001",
    latitude: 13.73, longitude: 100.47, accuracy_meters: 10,
    speed_meters_per_second: 0, bearing_degrees: null,
    captured_at: new Date(now + seconds * 1000).toISOString(),
    received_at: new Date(now + seconds * 1000).toISOString(), ...overrides,
  };
}
function advance(state: RouteSignal, seconds: number, position = fix(seconds)) {
  return advanceRouteSignal(state, position, vehicle, now + seconds * 1000);
}
const waiting: RouteSignal = { vehicleId: vehicle, kind: "waiting" };

test("routes wait for distinct fresh fixes over three seconds, then stay ready", () => {
  let state = advance(waiting, 0);
  assert.equal(state.kind, "checking");
  state = advance(state, 1);
  state = advance(state, 2);
  assert.equal(state.kind, "checking");
  state = advance(state, 3);
  assert.deepEqual(state, { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 3000 });
  assert.deepEqual(advance(state, 4), { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 4000 });
});

test("clock ticks and replayed captures cannot establish stability", () => {
  let state = advance(waiting, 0);
  state = advance(state, 3, fix(0));
  state = advance(state, 4, fix(0, { revision: 100 }));
  assert.equal(state.kind, "checking");
  state = advance(state, 5);
  assert.equal(state.kind, "checking");
  assert.deepEqual(advance(state, 6), { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 6000 });
});

test("a buffered burst must also span three seconds of observation", () => {
  let state = advanceRouteSignal(waiting, fix(0), vehicle, now + 5000);
  state = advanceRouteSignal(state, fix(3), vehicle, now + 5000);
  state = advanceRouteSignal(state, fix(5), vehicle, now + 5000);
  assert.equal(state.kind, "checking");
  assert.deepEqual(advance(state, 8), { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 8000 });
});

test("loss clears readiness and requires a new complete recovery", () => {
  let state = advance(advance(advance(waiting, 0), 1), 3);
  assert.equal(state.kind, "ready");
  state = advance(state, 14, fix(3));
  assert.deepEqual(state, waiting);
  state = advance(state, 15);
  state = advance(state, 16);
  state = advance(state, 17, fix(17, { accuracy_meters: 51 }));
  assert.deepEqual(state, waiting);
  state = advance(state, 18);
  state = advance(state, 19);
  assert.equal(state.kind, "checking");
  assert.deepEqual(advance(state, 21), { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 21000 });
});

test("missing, inaccurate, mismatched and future positions cannot retain a route", () => {
  const ready: RouteSignal = { vehicleId: vehicle, kind: "ready", lastCapturedAt: now };
  for (const position of [null, fix(0, { accuracy_meters: null }), fix(0, { accuracy_meters: 51 }), fix(0, { vehicle_id: "SHUTTLE-02" }), fix(6)]) {
    assert.equal(usableRoutePosition(position, vehicle, now), false);
    assert.deepEqual(advanceRouteSignal(ready, position, vehicle, now), waiting);
  }
  assert.equal(usableRoutePosition(fix(0, { accuracy_meters: 50 }), vehicle, now), true);
  const other = advanceRouteSignal(ready, fix(0, { vehicle_id: "SHUTTLE-02" }), "SHUTTLE-02", now);
  assert.equal(other.kind, "checking");
});


test("a fresh fix after an unobserved outage restarts recovery", () => {
  let state = advance(advance(advance(waiting, 0), 1), 3);
  assert.equal(state.kind, "ready");
  assert.equal(routeSignalGap(state, fix(30), vehicle), true);
  state = advance(state, 30);
  assert.equal(state.kind, "checking");
  state = advance(state, 31);
  assert.equal(state.kind, "checking");
  assert.deepEqual(advance(state, 33), { vehicleId: vehicle, kind: "ready", lastCapturedAt: now + 33000 });
});
