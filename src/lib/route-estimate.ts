import { freshness, type Position } from "./domain";
import { remainingRoute } from "./remaining-route";
import type { RouteSnapshot } from "./pickup-route-cache";

export type RouteEstimate =
  | { kind: "estimated"; distanceMeters: number | null; remainingMinutes: number }
  | { kind: "unavailable"; reason: "gps" };

export function estimateRemainingRoute({ snapshot, position, now }: {
  snapshot: RouteSnapshot;
  position: Position | null;
  now: number;
}): RouteEstimate {
  const { route, receivedAt } = snapshot;
  if (!position || position.vehicle_id !== route.vehicleId || freshness(position, now).kind !== "live" || position.accuracy_meters === null || position.accuracy_meters > 50) {
    return { kind: "unavailable", reason: "gps" };
  }
  const elapsedMinutes = Math.floor(Math.max(0, now - receivedAt) / 60000);
  const progress = remainingRoute({ route, position, now });
  return {
    kind: "estimated",
    distanceMeters: progress ? route.distanceMeters * progress.remainingFraction : null,
    remainingMinutes: Math.max(0, Math.ceil(route.durationSeconds / 60) - elapsedMinutes),
  };
}
