import { test } from "node:test";
import assert from "node:assert/strict";
import { demoScenarioSchema, demoState, type DemoScenario } from "../src/components/demo-scenarios";
import { PICKUP_STOPS } from "../src/lib/pickups";

const now = Date.UTC(2026, 10, 8);
function preview(scenario: DemoScenario) {
  return demoState({ scenario, vehicleId: "SHUTTLE-02", stopId: "talat-phlu", selection: scenario === "initial" ? null : { stopId: "talat-phlu", source: "manual", revision: 1 }, now, select: () => {}, locate: () => {}, refreshRoute: () => {} });
}
test("demo query accepts only known scenarios", () => {
  assert.equal(demoScenarioSchema.catch("initial").parse("arrived"), "arrived");
  assert.equal(demoScenarioSchema.catch("initial").parse("unknown"), "initial");
});
test("arrival preview remains inspectable without starting a reload", () => {
  const view = preview("arrived");
  assert.equal(view.pickup.arrived, true);
  assert.equal(view.pickup.reloading, false);
  assert.equal(view.pickup.canRefreshRoute, false);
  assert.equal(view.pickup.selected?.label, "BTS ตลาดพลู");
  assert.equal(view.position?.vehicle_id, "SHUTTLE-02");
});
test("near arrival uses a short geometry ending at the selected pickup", () => {
  const view = preview("near");
  assert.deepEqual(view.pickup.estimate, { kind: "estimated", remainingMinutes: 1, distanceMeters: 20 });
  assert.deepEqual(view.pickup.route?.points, [[13.714682, 100.477552], [PICKUP_STOPS[0].latitude, PICKUP_STOPS[0].longitude]]);
});
test("GPS and error previews show their observable fallback", () => {
  assert.equal(preview("initial").pickup.selected, null);
  assert.equal(preview("no-gps").position, null);
  assert.equal(preview("stale-gps").position?.captured_at, new Date(now - 30000).toISOString());
  assert.equal(preview("provider-unavailable").pickup.routeStatus, "ยังไม่พร้อมแสดงเส้นทางและเวลาถึง");
  assert.equal(preview("offline").connection, "offline");
  assert.equal(preview("denied").pickup.locationMessage, "ยังไม่ได้อนุญาตตำแหน่ง เลือกจุดขึ้นรถเองได้");
  assert.equal(preview("refresh-error").pickup.estimate?.kind, "estimated");
  assert.equal(preview("map-error").mapPreview, "error");
});
