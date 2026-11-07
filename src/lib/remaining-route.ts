import { freshness, type Position } from "./domain";
import type { RoadRoute } from "./pickups";

export function remainingRoute({ route, position, now }: {
  route: RoadRoute;
  position: Position | null;
  now: number;
}): { points: RoadRoute["points"]; remainingFraction: number } | null {
  if (!position || position.vehicle_id !== route.vehicleId || freshness(position, now).kind !== "live" || position.accuracy_meters === null || position.accuracy_meters > 50) return null;
  const accuracy = position.accuracy_meters;
  const metresPerDegree = 6371000 * Math.PI / 180;
  const longitudeScale = Math.cos(position.latitude * Math.PI / 180);
  const relative = route.points.map(([latitude, longitude]) => ({
    x: (longitude - position.longitude) * metresPerDegree * longitudeScale,
    y: (latitude - position.latitude) * metresPerDegree,
  }));
  const projections: { index: number; fraction: number; offset: number; progress: number }[] = [];
  let length = 0;
  for (let index = 1; index < relative.length; index++) {
    const start = relative[index - 1];
    const end = relative[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) continue;
    const fraction = Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / (segmentLength * segmentLength)));
    projections.push({ index, fraction, offset: Math.hypot(start.x + fraction * dx, start.y + fraction * dy), progress: length + fraction * segmentLength });
    length += segmentLength;
  }
  const nearest = projections.reduce<(typeof projections)[number] | null>((best, candidate) => !best || candidate.offset < best.offset ? candidate : best, null);
  if (!nearest || nearest.offset > 50 + accuracy) return null;
  if (projections.some(candidate => candidate.offset <= nearest.offset + Math.max(10, accuracy) && Math.abs(candidate.progress - nearest.progress) > 150)) return null;
  const start = route.points[nearest.index - 1];
  const end = route.points[nearest.index];
  const projected: [number, number] = [start[0] + (end[0] - start[0]) * nearest.fraction, start[1] + (end[1] - start[1]) * nearest.fraction];
  const points: RoadRoute["points"] = [[position.latitude, position.longitude]];
  if (nearest.offset > 0.01) points.push(projected);
  points.push(...route.points.slice(nearest.index));
  return { points, remainingFraction: Math.max(0, Math.min(1, 1 - nearest.progress / length)) };
}
