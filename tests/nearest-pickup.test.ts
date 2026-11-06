import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestPickup } from "../src/lib/pickups";

test("nearest pickup uses device coordinates even outside the 50 metre radius", () => {
  assert.equal(nearestPickup({ latitude: 13.714582, longitude: 100.477552 }).id, "talat-phlu");
  assert.equal(nearestPickup({ latitude: 13.730175, longitude: 100.473615 }).id, "tha-phra");
  assert.equal(nearestPickup({ latitude: 13.712, longitude: 100.48 }).id, "talat-phlu");
  assert.equal(nearestPickup({ latitude: 13.733, longitude: 100.47 }).id, "tha-phra");
});
