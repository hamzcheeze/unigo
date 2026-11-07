import { test } from "node:test";
import assert from "node:assert/strict";
import { freshness, incomingPositionSchema, mergePosition, positionSchema } from "../src/lib/domain";
import { authorizeDriver, boundedJson, captureRejection, parseDriverTokens } from "../src/lib/ingestion";

const incoming = {
  vehicleId: "SHUTTLE-01", sessionId: "a0000000-0000-4000-8000-000000000001", sequence: 1,
  latitude: 13.745, longitude: 100.561, capturedAtMs: 1_700_000_000_000, elapsedRealtimeNanos: 1000,
  provider: "gps", accuracyMeters: 5, speedMetersPerSecond: null, bearingDegrees: null, mock: false,
};
const row = positionSchema.parse({
  vehicle_id: "SHUTTLE-01", session_id: incoming.sessionId, sequence: 1, revision: 1,
  latitude: 13.745, longitude: 100.561, accuracy_meters: 5, speed_meters_per_second: null, bearing_degrees: null,
  captured_at: "2026-01-01T00:00:00Z", received_at: "2026-01-01T00:00:05Z",
});
test("Android contract parses GPS payload and rejects invalid external values", () => {
  assert.equal(incomingPositionSchema.parse(incoming).latitude, 13.745);
  for (const change of [{ latitude: 91 }, { longitude: Infinity }, { sequence: 0 }, { sessionId: "old" }, { vehicleId: "SHUTTLE-04" }, { provider: "network" }, { bearingDegrees: 360 }]) {
    assert.equal(incomingPositionSchema.safeParse({ ...incoming, ...change }).success, false);
  }
});
test("driver token is bound to one vehicle and configuration rejects shared tokens", () => {
  const tokens = parseDriverTokens(JSON.stringify({ "SHUTTLE-01": "a".repeat(43), "SHUTTLE-02": "b".repeat(43), "SHUTTLE-03": "c".repeat(43) }));
  assert.ok(tokens);
  assert.equal(authorizeDriver(`Bearer ${"a".repeat(43)}`, "SHUTTLE-01", tokens), true);
  assert.equal(authorizeDriver(`Bearer ${"a".repeat(43)}`, "SHUTTLE-02", tokens), false);
  assert.equal(authorizeDriver(null, "SHUTTLE-01", tokens), false);
  assert.equal(authorizeDriver("Bearer bad", "SHUTTLE-01", tokens), false);
  assert.equal(parseDriverTokens('{"SHUTTLE-01":"short"}'), null);
  assert.equal(parseDriverTokens(JSON.stringify({ "SHUTTLE-01": "a".repeat(43), "SHUTTLE-02": "a".repeat(43), "SHUTTLE-03": "a".repeat(43) })), null);
});
test("fresh receipt does not make stale capture live", () => {
  assert.deepEqual(freshness(row, Date.parse("2026-01-01T00:00:11Z")), { kind: "stale", ageSeconds: 11 });
  assert.deepEqual(freshness(row, Date.parse("2026-01-01T00:00:06Z")), { kind: "live", ageSeconds: 6 });
  assert.deepEqual(freshness(null), { kind: "unknown", ageSeconds: null });
  assert.deepEqual(freshness(row, Date.parse("2025-12-31T23:59:00Z")), { kind: "stale", ageSeconds: null });
});
test("late snapshot and repeated event cannot overwrite a newer revision", () => {
  const newer = { ...row, revision: 2, latitude: 13.746 };
  assert.equal(mergePosition(newer, row), newer);
  assert.equal(mergePosition(row, newer).latitude, 13.746);
  assert.equal(mergePosition(newer, { ...newer, latitude: 0 }).latitude, 13.746);
});
test("stale, future and mock fixes cannot enter live ingestion", () => {
  const fix = incomingPositionSchema.parse(incoming);
  assert.equal(captureRejection(fix, incoming.capturedAtMs + 15_001), "stale_position");
  assert.equal(captureRejection(fix, incoming.capturedAtMs - 5_001), "future_position");
  assert.equal(captureRejection({ ...fix, mock: true }, incoming.capturedAtMs), "mock_position");
  assert.equal(captureRejection(fix, incoming.capturedAtMs), null);
});
test("bounded JSON accepts normal body and rejects over-limit chunked input", async () => {
  assert.deepEqual(await boundedJson(new Request("https://example.com", { method: "POST", body: '{"ok":true}' })), { ok: true });
  await assert.rejects(boundedJson(new Request("https://example.com", { method: "POST", body: "x".repeat(8193) })), /body_too_large/);
});

test("incoming schema accepts inclusive coordinate, measurement, and integer boundaries", () => {
  for (const change of [
    { latitude: -90, longitude: -180, accuracyMeters: 0, speedMetersPerSecond: 0, bearingDegrees: 0 },
    { latitude: 90, longitude: 180, accuracyMeters: 100000, speedMetersPerSecond: 200, bearingDegrees: 359.999 },
    { sequence: Number.MAX_SAFE_INTEGER, capturedAtMs: Number.MAX_SAFE_INTEGER, elapsedRealtimeNanos: 0 },
    { accuracyMeters: null, speedMetersPerSecond: null, bearingDegrees: null },
  ]) {
    const expected = { ...incoming, ...change };
    assert.deepEqual(incomingPositionSchema.parse(expected), expected);
  }
});

for (const [field, values] of Object.entries({
  latitude: [-90.001, 90.001, NaN, Infinity, "13.7", null],
  longitude: [-180.001, 180.001, NaN, -Infinity],
  sequence: [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN],
  capturedAtMs: [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1],
  elapsedRealtimeNanos: [-1, NaN, Infinity],
  accuracyMeters: [-0.001, 100000.001, NaN, Infinity],
  speedMetersPerSecond: [-0.001, 200.001, NaN, Infinity],
  bearingDegrees: [-0.001, 360, NaN, Infinity],
  mock: [null, "false", 0],
  provider: [null, "network", "GPS"],
  sessionId: [null, "", "a0000000-0000-0000-0000-000000000001"],
})) {
  test(`incoming schema rejects invalid ${field} values`, () => {
    for (const value of values) assert.equal(incomingPositionSchema.safeParse({ ...incoming, [field]: value }).success, false, `${field}: ${String(value)}`);
    const missing: Record<string, unknown> = { ...incoming };
    delete missing[field];
    assert.equal(incomingPositionSchema.safeParse(missing).success, false);
  });
}

test("stored schema validates integer revisions, timestamps, and nullable measurements", () => {
  assert.deepEqual(positionSchema.parse({ ...row, revision: Number.MAX_SAFE_INTEGER, accuracy_meters: null }), { ...row, revision: Number.MAX_SAFE_INTEGER, accuracy_meters: null });
  for (const change of [
    { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { sequence: 0 }, { captured_at: "2026-01-01" }, { received_at: "not-a-date" },
    { captured_at: "2026-02-30T00:00:00Z" }, { accuracy_meters: -1 },
    { speed_meters_per_second: 201 }, { bearing_degrees: 360 },
  ]) assert.equal(positionSchema.safeParse({ ...row, ...change }).success, false);
  assert.equal(positionSchema.parse({ ...row, captured_at: "2026-01-01T07:00:00+07:00" }).captured_at, "2026-01-01T07:00:00+07:00");
});

test("freshness has inclusive ten-second age and five-second future bounds", () => {
  const now = Date.parse("2026-01-01T00:00:10Z");
  assert.deepEqual(freshness(row, now), { kind: "live", ageSeconds: 10 });
  assert.deepEqual(freshness(row, now + 1), { kind: "stale", ageSeconds: 10.001 });
  const future = "2026-01-01T00:00:15Z";
  assert.deepEqual(freshness({ ...row, captured_at: future, received_at: future }, now), { kind: "live", ageSeconds: 0 });
  for (const field of ["captured_at", "received_at"]) {
    assert.deepEqual(freshness({ ...row, [field]: "2026-01-01T00:00:15.001Z" }, now), { kind: "stale", ageSeconds: null });
  }
  assert.deepEqual(freshness({ ...row, captured_at: "2026-01-01T00:00:09Z", received_at: "2025-12-31T23:59:59Z" }, now), { kind: "stale", ageSeconds: 11 });
});

test("merge initializes empty state and accepts another vehicle independently of revision", () => {
  assert.deepEqual(mergePosition(null, row), row);
  const other = positionSchema.parse({ ...row, vehicle_id: "SHUTTLE-02", latitude: 1 });
  assert.deepEqual(mergePosition({ ...row, revision: 999 }, other), other);
});

test("ingestion time boundaries accept exactly fifteen seconds old or five seconds ahead", () => {
  const fix = incomingPositionSchema.parse(incoming);
  assert.equal(captureRejection(fix, fix.capturedAtMs + 15000), null);
  assert.equal(captureRejection(fix, fix.capturedAtMs - 5000), null);
  assert.equal(captureRejection({ ...fix, mock: true }, fix.capturedAtMs + 999999), "mock_position");
});
