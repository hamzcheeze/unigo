import { z } from "zod";

export const vehicleIdSchema = z.enum(["SHUTTLE-01", "SHUTTLE-02", "SHUTTLE-03"]);
export type VehicleId = z.infer<typeof vehicleIdSchema>;
export const VEHICLES = [
  { id: vehicleIdSchema.enum["SHUTTLE-01"], label: "คันที่ 1", color: "#EE0578" },
  { id: vehicleIdSchema.enum["SHUTTLE-02"], label: "คันที่ 2", color: "#EE0578" },
  { id: vehicleIdSchema.enum["SHUTTLE-03"], label: "คันที่ 3", color: "#EE0578" },
];
const coordinateLatitude = z.number().finite().min(-90).max(90);
const coordinateLongitude = z.number().finite().min(-180).max(180);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableAccuracy = z.number().finite().min(0).max(100_000).nullable();
const nullableSpeed = z.number().finite().min(0).max(200).nullable();
const nullableBearing = z.number().finite().min(0).lt(360).nullable();
export const positionSchema = z.object({
  vehicle_id: vehicleIdSchema,
  revision: safeInteger.positive(),
  session_id: z.uuid(),
  sequence: safeInteger.positive(),
  latitude: coordinateLatitude,
  longitude: coordinateLongitude,
  accuracy_meters: nullableAccuracy,
  speed_meters_per_second: nullableSpeed,
  bearing_degrees: nullableBearing,
  captured_at: z.iso.datetime({ offset: true }),
  received_at: z.iso.datetime({ offset: true }),
});
export type Position = z.infer<typeof positionSchema>;
export const incomingPositionSchema = z.object({
  vehicleId: vehicleIdSchema,
  sessionId: z.uuid(),
  sequence: safeInteger.positive(),
  latitude: coordinateLatitude,
  longitude: coordinateLongitude,
  capturedAtMs: safeInteger.positive(),
  elapsedRealtimeNanos: z.number().finite().nonnegative(),
  provider: z.literal("gps"),
  accuracyMeters: nullableAccuracy,
  speedMetersPerSecond: nullableSpeed,
  bearingDegrees: nullableBearing,
  mock: z.boolean(),
});
export type IncomingPosition = z.infer<typeof incomingPositionSchema>;

export function freshness(position: Position | null, nowMs = Date.now()):
  { kind: "live" | "stale" | "unknown"; ageSeconds: number | null } {
  if (!position) return { kind: "unknown", ageSeconds: null };
  const captured = Date.parse(position.captured_at);
  const received = Date.parse(position.received_at);
  if (captured > nowMs + 5000 || received > nowMs + 5000) return { kind: "stale", ageSeconds: null };
  const ageSeconds = Math.max(0, (nowMs - Math.min(captured, received)) / 1000);
  return { kind: ageSeconds <= 10 ? "live" : "stale", ageSeconds };
}

export function mergePosition(current: Position | null, incoming: Position): Position {
  if (!current || incoming.vehicle_id !== current.vehicle_id || incoming.revision > current.revision) return incoming;
  return current;
}
