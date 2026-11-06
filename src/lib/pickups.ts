import { z } from "zod";
import { vehicleIdSchema } from "./domain";
import { distanceMeters } from "./geofence";

export const pickupStopIdSchema = z.enum(["talat-phlu", "tha-phra"]);
export type PickupStopId = z.infer<typeof pickupStopIdSchema>;
export const PICKUP_STOPS = [
  { id: pickupStopIdSchema.enum["talat-phlu"], label: "BTS ตลาดพลู", latitude: 13.714582, longitude: 100.477552 },
  { id: pickupStopIdSchema.enum["tha-phra"], label: "MRT ท่าพระ", latitude: 13.730175, longitude: 100.473615 },
];
export type PickupStop = (typeof PICKUP_STOPS)[number];
export type PickupSelection = { stopId: PickupStopId; source: "manual" | "nearest"; revision: number };

export function nearestPickup(location: { latitude: number; longitude: number }): PickupStop {
  return PICKUP_STOPS.reduce((nearest, stop) => distanceMeters(location, stop) < distanceMeters(location, nearest) ? stop : nearest);
}
export const routeResponseSchema = z.object({
  points: z.array(z.tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)])).min(2).max(20000),
  durationSeconds: z.number().finite().nonnegative().max(86400),
  distanceMeters: z.number().finite().nonnegative().max(1000000),
  fetchedAt: z.iso.datetime(),
  vehicleId: vehicleIdSchema,
  stopId: pickupStopIdSchema,
  sourceRevision: z.number().int().positive(),
  trafficAware: z.literal(true),
  provider: z.literal("tomtom"),
});
export type RoadRoute = z.infer<typeof routeResponseSchema>;
