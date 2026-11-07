import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "../src/lib/domain";
import type { RoadRoute } from "../src/lib/pickups";
import { remainingRoutePoints } from "../src/lib/remaining-route";

const now = Date.UTC(2026, 10, 7);
const route: RoadRoute = {
  points: [[0, 0], [0, 0.01], [0.01, 0.01]], distanceMeters: 2000, durationSeconds: 600,
  vehicleId: "SHUTTLE-01", stopId: "talat-phlu", sourceRevision: 1,
  fetchedAt: new Date(now).toISOString(), trafficAware: true, provider: "tomtom",
};
const position: Position = {
  vehicle_id: "SHUTTLE-01", revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1,
  latitude: 0, longitude: 0.005, accuracy_meters: 5, speed_meters_per_second: 0, bearing_degrees: 90,
  captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString(),
};
const clip = (fix: Position | null = position, road = route) => remainingRoutePoints({ route: road, position: fix, now });

test("moving along a cached road removes the prefix and preserves corners and destination", () => {
  const before = structuredClone(route);
  assert.deepEqual(clip(), [[0, 0.005], [0, 0.01], [0.01, 0.01]]);
  assert.deepEqual(clip({ ...position, latitude: 0.005, longitude: 0.01 }), [[0.005, 0.01], [0.01, 0.01]]);
  assert.deepEqual(route, before);
});

test("the route begins at the actual fix with only a short connector to the road", () => {
  const points = clip({ ...position, latitude: 0.0001 });
  assert.deepEqual(points, [[0.0001, 0.005], [0, 0.005], [0, 0.01], [0.01, 0.01]]);
});

test("projection clamps at the start and destination without extending the road", () => {
  assert.deepEqual(clip({ ...position, longitude: -0.0001 }), [[0, -0.0001], [0, 0], [0, 0.01], [0.01, 0.01]]);
  assert.deepEqual(clip({ ...position, latitude: 0.01, longitude: 0.01 }), [[0.01, 0.01], [0.01, 0.01]]);
});

test("untrusted fixes and far off-route positions do not manufacture a new road", () => {
  assert.deepEqual(clip(), [[0, 0.005], [0, 0.01], [0.01, 0.01]]);
  for (const fix of [null, { ...position, accuracy_meters: null }, { ...position, accuracy_meters: 50.01 }, { ...position, captured_at: new Date(now - 10001).toISOString() }, { ...position, received_at: new Date(now + 5001).toISOString() }, { ...position, latitude: 0.02, longitude: 0.02 }, { ...position, vehicle_id: "SHUTTLE-02" } satisfies Position]) assert.equal(clip(fix), null);
});

test("nearby road crossings with distant route progress remain ambiguous", () => {
  const loop: RoadRoute = { ...route, points: [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]] };
  assert.equal(clip({ ...position, longitude: 0 }, loop), null);
  assert.deepEqual(clip({ ...position, longitude: 0 }, route), route.points);
});

test("zero-length segments are skipped and completely degenerate geometry cannot be projected", () => {
  assert.deepEqual(clip(position, { ...route, points: [[0, 0], [0, 0], [0, 0.01]] }), [[0, 0.005], [0, 0.01]]);
  assert.equal(clip(position, { ...route, points: [[0, 0], [0, 0]] }), null);
});
