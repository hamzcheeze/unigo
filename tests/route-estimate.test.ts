import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "../src/lib/domain";
import type { RoadRoute } from "../src/lib/pickups";
import { estimateRemainingRoute } from "../src/lib/route-estimate";

const now = Date.UTC(2026, 10, 6);
const route: RoadRoute = {
  points: [[0, 0], [0, 0.01]], distanceMeters: 2000, durationSeconds: 600,
  vehicleId: "SHUTTLE-01", stopId: "talat-phlu", sourceRevision: 1,
  fetchedAt: new Date(now).toISOString(), trafficAware: true, provider: "tomtom",
};
const position: Position = {
  vehicle_id: "SHUTTLE-01", revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1,
  latitude: 0, longitude: 0, accuracy_meters: 5, speed_meters_per_second: 0, bearing_degrees: 90,
  captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString(),
};

test("remaining estimate follows progress along cached geometry using provider distance and duration", () => {
  for (const [longitude, expectedDistance, expectedDuration] of [[0, 2000, 600], [0.005, 1000, 300], [0.01, 0, 0]]) {
    const result = estimateRemainingRoute({ route, position: { ...position, longitude }, now });
    assert.equal(result.kind, "estimated");
    if (result.kind !== "estimated") throw new Error("Expected a route estimate");
    assert.ok(Math.abs(result.distanceMeters - expectedDistance) < 0.01);
    assert.ok(Math.abs(result.durationSeconds - expectedDuration) < 0.01);
  }
});

test("a stationary vehicle does not count down as fresh GPS timestamps advance", () => {
  const first = estimateRemainingRoute({ route, position: { ...position, longitude: 0.005 }, now });
  const later = now + 60000;
  const second = estimateRemainingRoute({ route, position: { ...position, longitude: 0.005, captured_at: new Date(later).toISOString(), received_at: new Date(later).toISOString() }, now: later });
  assert.deepEqual(first, { kind: "estimated", distanceMeters: 1000, durationSeconds: 300 });
  assert.deepEqual(second, first);
});

test("backward movement increases the remaining estimate and corners use road progress", () => {
  const backwards = estimateRemainingRoute({ route, position: { ...position, longitude: 0.0025 }, now });
  assert.deepEqual(backwards, { kind: "estimated", distanceMeters: 1500, durationSeconds: 450 });
  const corner = estimateRemainingRoute({ route: { ...route, points: [[0, 0], [0, 0.01], [0.01, 0.01]] }, position: { ...position, latitude: 0.005, longitude: 0.01 }, now });
  assert.equal(corner.kind, "estimated");
  if (corner.kind !== "estimated") throw new Error("Expected a route estimate");
  assert.ok(Math.abs(corner.distanceMeters - 500) < 0.01);
  assert.ok(Math.abs(corner.durationSeconds - 150) < 0.01);
});

test("missing, stale, future, inaccurate and wrong-vehicle GPS cannot produce ETA", () => {
  for (const value of [null, { ...position, captured_at: new Date(now - 11000).toISOString() }, { ...position, received_at: new Date(now + 5001).toISOString() }, { ...position, accuracy_meters: null }, { ...position, accuracy_meters: 51 }, { ...position, vehicle_id: "SHUTTLE-02" } satisfies Position]) {
    assert.deepEqual(estimateRemainingRoute({ route, position: value, now }), { kind: "unavailable", reason: "gps" });
  }
});

test("old route traffic and implausibly future fetched times cannot produce ETA", () => {
  for (const fetchedAt of [new Date(now - 15 * 60000 - 1).toISOString(), new Date(now + 5001).toISOString()]) {
    assert.deepEqual(estimateRemainingRoute({ route: { ...route, fetchedAt }, position, now }), { kind: "unavailable", reason: "old-route" });
  }
  assert.deepEqual(estimateRemainingRoute({ route: { ...route, fetchedAt: new Date(now - 15 * 60000).toISOString() }, position, now }), { kind: "estimated", distanceMeters: 2000, durationSeconds: 600 });
});

test("off-route and degenerate geometry yield no ETA without changing cached geometry", () => {
  const originalPoints = route.points.map(point => [...point]);
  assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, latitude: 0.01, longitude: 0.005 }, now }), { kind: "unavailable", reason: "off-route" });
  assert.deepEqual(route.points, originalPoints);
  assert.deepEqual(estimateRemainingRoute({ route: { ...route, points: [[0, 0], [0, 0]] }, position, now }), { kind: "unavailable", reason: "off-route" });
  assert.deepEqual(estimateRemainingRoute({ route: { ...route, points: [[0, 0], [0, 0], [0, 0.01]] }, position, now }), { kind: "estimated", distanceMeters: 2000, durationSeconds: 600 });
});

test("loop intersections cannot imply two different remaining distances", () => {
  const loop: RoadRoute = { ...route, points: [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]] };
  assert.deepEqual(estimateRemainingRoute({ route: loop, position, now }), { kind: "unavailable", reason: "ambiguous-route" });
});

test("GPS freshness and accuracy boundaries permit ETA only through the inclusive limit", () => {
  for (const patch of [
    { accuracy_meters: 50 },
    { captured_at: new Date(now - 10000).toISOString() },
    { received_at: new Date(now - 10000).toISOString() },
    { captured_at: new Date(now + 5000).toISOString() },
  ]) {
    assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, ...patch }, now }), { kind: "estimated", distanceMeters: 2000, durationSeconds: 600 });
  }
  for (const patch of [
    { accuracy_meters: 50.001 },
    { captured_at: new Date(now - 10001).toISOString() },
    { received_at: new Date(now - 10001).toISOString() },
    { captured_at: new Date(now + 5001).toISOString() },
  ]) {
    assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, ...patch }, now }), { kind: "unavailable", reason: "gps" });
  }
});

test("route fetched exactly five seconds ahead is accepted", () => {
  assert.deepEqual(estimateRemainingRoute({ route: { ...route, fetchedAt: new Date(now + 5000).toISOString() }, position, now }), { kind: "estimated", distanceMeters: 2000, durationSeconds: 600 });
});

test("projection clamps progress before the start and after the destination", () => {
  assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, longitude: -0.0001 }, now }), { kind: "estimated", distanceMeters: 2000, durationSeconds: 600 });
  assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, longitude: 0.0101 }, now }), { kind: "estimated", distanceMeters: 0, durationSeconds: 0 });
});

test("cross-track distance uses GPS accuracy allowance and rejects just outside it", () => {
  const metersPerDegree = 6371000 * Math.PI / 180;
  assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, longitude: 0.005, latitude: 54.99 / metersPerDegree }, now }), { kind: "estimated", distanceMeters: 1000, durationSeconds: 300 });
  assert.deepEqual(estimateRemainingRoute({ route, position: { ...position, longitude: 0.005, latitude: 55.01 / metersPerDegree }, now }), { kind: "unavailable", reason: "off-route" });
});

test("empty or singleton geometry cannot fabricate ETA, and zero provider totals remain zero", () => {
  for (const points of [[], [[0, 0]] satisfies RoadRoute["points"]]) {
    assert.deepEqual(estimateRemainingRoute({ route: { ...route, points }, position, now }), { kind: "unavailable", reason: "off-route" });
  }
  assert.deepEqual(estimateRemainingRoute({ route: { ...route, distanceMeters: 0, durationSeconds: 0 }, position: { ...position, longitude: 0.005 }, now }), { kind: "estimated", distanceMeters: 0, durationSeconds: 0 });
});
