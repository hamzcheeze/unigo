import { freshness, type Position, type VehicleId } from "./domain";

export type RouteSignal = { vehicleId: VehicleId } & (
  | { kind: "waiting" }
  | { kind: "checking"; firstObservedAt: number; firstCapturedAt: number; lastCapturedAt: number; lastRevision: number; fixes: number }
  | { kind: "ready"; lastCapturedAt: number }
);

export function usableRoutePosition(position: Position | null, vehicleId: VehicleId, now: number): boolean {
  return Boolean(position && position.vehicle_id === vehicleId && freshness(position, now).kind === "live"
    && position.accuracy_meters !== null && position.accuracy_meters <= 50);
}

export function routeSignalGap(state: RouteSignal, position: Position | null, vehicleId: VehicleId): boolean {
  return state.vehicleId === vehicleId && state.kind !== "waiting" && position?.vehicle_id === vehicleId
    && Date.parse(position.captured_at) - state.lastCapturedAt > 10000;
}

export function advanceRouteSignal(state: RouteSignal, position: Position | null, vehicleId: VehicleId, now: number): RouteSignal {
  if (!position || !usableRoutePosition(position, vehicleId, now)) return { vehicleId, kind: "waiting" };
  const capturedAt = Date.parse(position.captured_at);
  const gap = routeSignalGap(state, position, vehicleId);
  if (state.vehicleId === vehicleId && state.kind === "ready" && !gap) {
    return capturedAt > state.lastCapturedAt ? { ...state, lastCapturedAt: capturedAt } : state;
  }
  if (state.vehicleId !== vehicleId || state.kind !== "checking" || gap) {
    return { vehicleId, kind: "checking", firstObservedAt: now, firstCapturedAt: capturedAt, lastCapturedAt: capturedAt, lastRevision: position.revision, fixes: 1 };
  }
  if (position.revision <= state.lastRevision || capturedAt <= state.lastCapturedAt) return state;
  const fixes = state.fixes + 1;
  if (fixes >= 3 && now - state.firstObservedAt >= 3000 && capturedAt - state.firstCapturedAt >= 3000) {
    return { vehicleId, kind: "ready", lastCapturedAt: capturedAt };
  }
  return { ...state, lastCapturedAt: capturedAt, lastRevision: position.revision, fixes };
}
