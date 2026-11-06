import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, isFreshLocation, withinPickupRadius } from "../src/lib/geofence";

test("50 metre pickup includes GPS uncertainty", () => {
  const stop = { latitude: 0, longitude: 0 };
  assert.equal(withinPickupRadius({ ...stop, accuracy: 50 }, stop), true);
  assert.equal(withinPickupRadius({ ...stop, accuracy: 51 }, stop), false);
  const point = { latitude: 0.00036, longitude: 0, accuracy: 5 };
  assert.ok(distanceMeters(point, stop) > 39 && distanceMeters(point, stop) < 41);
  assert.equal(withinPickupRadius(point, stop), true);
  assert.equal(withinPickupRadius({ ...point, accuracy: 20 }, stop), false);
  assert.equal(withinPickupRadius({ latitude: 0.001, longitude: 0, accuracy: 0 }, stop), false);
});
test("old or implausibly future resident GPS cannot select a stop", () => {
  assert.equal(isFreshLocation(40000, 100000), true);
  assert.equal(isFreshLocation(39999, 100000), false);
  assert.equal(isFreshLocation(105001, 100000), false);
  assert.equal(isFreshLocation(NaN, 100000), false);
});
