import { freshness, type Position } from "./domain";
import type { RoadRoute } from "./pickups";

export type RouteEstimate =
  | { kind: "estimated"; distanceMeters: number; durationSeconds: number }
  | { kind: "unavailable"; reason: "gps" | "off-route" | "old-route" | "ambiguous-route" };

export function estimateRemainingRoute({ route, position, now }: {
  route: RoadRoute;
  position: Position | null;
  now: number;
}): RouteEstimate {
  if (!position || position.vehicle_id !== route.vehicleId || freshness(position, now).kind !== "live" || position.accuracy_meters === null || position.accuracy_meters > 50) {
    return { kind: "unavailable", reason: "gps" };
  }
  const routeAge = now - Date.parse(route.fetchedAt);
  if (routeAge > 15 * 60 * 1000 || routeAge < -5000) return { kind: "unavailable", reason: "old-route" };
  const accuracy = position.accuracy_meters;

  const metresPerDegree = 6371000 * Math.PI / 180;
  const longitudeScale = Math.cos(position.latitude * Math.PI / 180);
  const points = route.points.map(([latitude, longitude]) => ({
    x: (longitude - position.longitude) * metresPerDegree * longitudeScale,
    y: (latitude - position.latitude) * metresPerDegree,
  }));
  const projections: { offset: number; progress: number }[] = [];
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) continue;
    const fraction = Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / (segmentLength * segmentLength)));
    projections.push({
      offset: Math.hypot(start.x + fraction * dx, start.y + fraction * dy),
      progress: length + fraction * segmentLength,
    });
    length += segmentLength;
  }
  const nearest = projections.reduce<(typeof projections)[number] | null>((best, point) => !best || point.offset < best.offset ? point : best, null);
  if (!nearest || nearest.offset > 50 + accuracy) return { kind: "unavailable", reason: "off-route" };
  if (projections.some(point => point.offset <= nearest.offset + Math.max(10, accuracy) && Math.abs(point.progress - nearest.progress) > 150)) {
    return { kind: "unavailable", reason: "ambiguous-route" };
  }
  const remaining = Math.max(0, Math.min(1, 1 - nearest.progress / length));
  return { kind: "estimated", distanceMeters: route.distanceMeters * remaining, durationSeconds: route.durationSeconds * remaining };
}
