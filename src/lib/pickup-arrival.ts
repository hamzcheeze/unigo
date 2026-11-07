import { freshness, type Position, type VehicleId } from "./domain";
import { withinPickupRadius } from "./geofence";
import { PICKUP_STOPS, type PickupSelection, type RoadRoute } from "./pickups";
import { remainingRoute } from "./remaining-route";

export type ArrivalState = { key: string | null } & (
  | { kind: "watching" }
  | { kind: "confirming"; firstCapturedAt: number; lastCapturedAt: number }
  | { kind: "arrived"; reloadAt: number }
);

export function arrivalKey(vehicleId: VehicleId, selection: PickupSelection | null): string | null {
  return selection ? `${vehicleId}:${selection.stopId}:${selection.revision}` : null;
}

export function advanceArrival({ state, vehicleId, selection, position, route, now, demo }: {
  state: ArrivalState; vehicleId: VehicleId; selection: PickupSelection | null;
  position: Position | null; route: RoadRoute | null; now: number; demo: boolean;
}): ArrivalState {
  const key = arrivalKey(vehicleId, selection);
  if (!demo && key !== null && state.key === key && state.kind === "arrived") return state;
  const stop = PICKUP_STOPS.find(value => value.id === selection?.stopId);
  const watching: ArrivalState = { key, kind: "watching" };
  if (demo || !stop || !position || position.vehicle_id !== vehicleId || !route || route.vehicleId !== vehicleId || route.stopId !== stop.id
    || freshness(position, now).kind !== "live" || position.accuracy_meters === null
    || !withinPickupRadius({ ...position, accuracy: position.accuracy_meters }, stop)) return watching;
  const progress = remainingRoute({ route, position, now });
  if (!progress || route.distanceMeters * progress.remainingFraction > 50) return watching;
  const capturedAt = Date.parse(position.captured_at);
  if (state.key !== key || state.kind !== "confirming") return { key, kind: "confirming", firstCapturedAt: capturedAt, lastCapturedAt: capturedAt };
  if (capturedAt <= state.lastCapturedAt) return state;
  if (capturedAt - state.lastCapturedAt > 10000) return { key, kind: "confirming", firstCapturedAt: capturedAt, lastCapturedAt: capturedAt };
  return capturedAt - state.firstCapturedAt >= 2000
    ? { key, kind: "arrived", reloadAt: now + 10000 }
    : { ...state, lastCapturedAt: capturedAt };
}

export function scheduleArrivalReload({ reloadAt, now, schedule, cancel, onFade, onReload, onVisible }: {
  reloadAt: number; now: () => number;
  schedule: (callback: () => void, delay: number) => number; cancel: (timer: number) => void;
  onFade: () => void; onReload: () => void; onVisible: (callback: () => void) => () => void;
}): () => void {
  let active = true;
  let reloaded = false;
  let reloadTimer: number;
  const reload = () => {
    if (!active || reloaded) return;
    if (now() < reloadAt) {
      cancel(reloadTimer);
      reloadTimer = schedule(reload, reloadAt - now());
      return;
    }
    reloaded = true;
    onReload();
  };
  const fadeTimer = schedule(() => { if (active && !reloaded) onFade(); }, Math.max(0, reloadAt - now() - 180));
  reloadTimer = schedule(reload, Math.max(0, reloadAt - now()));
  const unsubscribe = onVisible(reload);
  if (now() >= reloadAt) reload();
  return () => { active = false; cancel(fadeTimer); cancel(reloadTimer); unsubscribe(); };
}
