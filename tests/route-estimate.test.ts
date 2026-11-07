import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "../src/lib/domain";
import type { RoadRoute } from "../src/lib/pickups";
import { estimateRemainingRoute } from "../src/lib/route-estimate";

const now = Date.UTC(2026, 10, 7);
const route: RoadRoute = {
  points: [[0, 0], [0, 0.01]], distanceMeters: 2000, durationSeconds: 780,
  vehicleId: "SHUTTLE-01", stopId: "talat-phlu", sourceRevision: 1,
  fetchedAt: new Date(now - 30000).toISOString(), trafficAware: true, provider: "tomtom",
};
const position: Position = {
  vehicle_id: "SHUTTLE-01", revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1,
  latitude: 0, longitude: 0, accuracy_meters: 5, speed_meters_per_second: 0, bearing_degrees: 90,
  captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString(),
};
function freshPosition(time: number): Position {
  return { ...position, captured_at: new Date(time).toISOString(), received_at: new Date(time).toISOString() };
}

test("API ETA decrements once per complete minute from client receipt", () => {
  for (const [elapsed, remainingMinutes] of [[0, 13], [59999, 13], [60000, 12], [119999, 12], [120000, 11], [660000, 2], [720000, 1], [780000, 0], [86400000, 0]]) {
    const time = now + elapsed;
    assert.deepEqual(estimateRemainingRoute({ snapshot: { route, receivedAt: now }, position: freshPosition(time), now: time }), {
      kind: "estimated", distanceMeters: 2000, remainingMinutes,
    });
  }
});

test("fractional API minutes round up and short or zero ETAs stay within the near-arrival threshold", () => {
  for (const [durationSeconds, remainingMinutes] of [[781, 14], [121, 3], [120, 2], [119, 2], [60, 1], [0, 0]]) {
    assert.deepEqual(estimateRemainingRoute({ snapshot: { route: { ...route, durationSeconds }, receivedAt: now }, position, now }), {
      kind: "estimated", distanceMeters: 2000, remainingMinutes,
    });
  }
});

test("stationary, backward and off-route movement do not change the countdown or saved distance", () => {
  const time = now + 60000;
  for (const longitude of [-0.01, 0, 0.005, 1]) {
    assert.deepEqual(estimateRemainingRoute({ snapshot: { route, receivedAt: now }, position: { ...freshPosition(time), longitude }, now: time }), {
      kind: "estimated", distanceMeters: 2000, remainingMinutes: 12,
    });
  }
});

test("old route timestamps do not stop the countdown and clock rollback does not increase its initial value", () => {
  assert.deepEqual(estimateRemainingRoute({ snapshot: { route: { ...route, fetchedAt: new Date(now - 86400000).toISOString() }, receivedAt: now }, position, now }), {
    kind: "estimated", distanceMeters: 2000, remainingMinutes: 13,
  });
  assert.deepEqual(estimateRemainingRoute({ snapshot: { route, receivedAt: now + 60000 }, position, now }), {
    kind: "estimated", distanceMeters: 2000, remainingMinutes: 13,
  });
});

test("missing, stale, future, inaccurate and wrong-vehicle GPS cannot produce ETA", () => {
  for (const value of [null, { ...position, captured_at: new Date(now - 10001).toISOString() }, { ...position, received_at: new Date(now - 10001).toISOString() }, { ...position, captured_at: new Date(now + 5001).toISOString() }, { ...position, received_at: new Date(now + 5001).toISOString() }, { ...position, accuracy_meters: null }, { ...position, accuracy_meters: 50.001 }, { ...position, vehicle_id: "SHUTTLE-02" } satisfies Position]) {
    assert.deepEqual(estimateRemainingRoute({ snapshot: { route, receivedAt: now }, position: value, now }), { kind: "unavailable", reason: "gps" });
  }
});

test("GPS freshness and accuracy boundaries permit ETA through the inclusive limit", () => {
  for (const patch of [
    { accuracy_meters: 50 },
    { captured_at: new Date(now - 10000).toISOString() },
    { received_at: new Date(now - 10000).toISOString() },
    { captured_at: new Date(now + 5000).toISOString() },
  ]) {
    assert.deepEqual(estimateRemainingRoute({ snapshot: { route, receivedAt: now }, position: { ...position, ...patch }, now }), {
      kind: "estimated", distanceMeters: 2000, remainingMinutes: 13,
    });
  }
});
