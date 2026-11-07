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

test("distance handles coincident, antipodal, polar, and antimeridian points", () => {
  assert.equal(distanceMeters({ latitude: 13.7, longitude: 100.5 }, { latitude: 13.7, longitude: 100.5 }), 0);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }) - 20015086.796) < 0.01);
  assert.ok(distanceMeters({ latitude: 90, longitude: -180 }, { latitude: 90, longitude: 180 }) < 0.001);
  const crossing = distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 });
  assert.ok(Math.abs(crossing - 222.38985) < 0.01);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: -179.999 }, { latitude: 0, longitude: 179.999 }) - 222.38985) < 0.01);
});

test("resident freshness includes future allowance boundary and rejects nonfinite timestamps", () => {
  assert.equal(isFreshLocation(105000, 100000), true);
  assert.equal(isFreshLocation(100000, 100000), true);
  assert.equal(isFreshLocation(Infinity, 100000), false);
  assert.equal(isFreshLocation(-Infinity, 100000), false);
});

test("pickup radius accepts exact uncertainty boundary and rejects invalid accuracy", () => {
  const stop = { latitude: 0, longitude: 0 };
  assert.equal(withinPickupRadius({ ...stop, accuracy: 0 }, stop), true);
  assert.equal(withinPickupRadius({ ...stop, accuracy: 50.00001 }, stop), false);
  for (const accuracy of [-1, NaN, Infinity, -Infinity]) assert.equal(withinPickupRadius({ ...stop, accuracy }, stop), false);
});
