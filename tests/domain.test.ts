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
