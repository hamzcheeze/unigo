"use client";

import { useEffect, useRef, useState } from "react";
import type { Position, VehicleId } from "@/lib/domain";
import type { PickupSelection, RoadRoute } from "@/lib/pickups";
import { advanceArrival, arrivalKey, scheduleArrivalReload, type ArrivalState } from "@/lib/pickup-arrival";

export function usePickupArrival(input: {
  vehicleId: VehicleId; selection: PickupSelection | null; position: Position | null;
  route: RoadRoute | null; now: number; demo: boolean;
}) {
  const { vehicleId, selection, position, route, now, demo } = input;
  const [state, setState] = useState<ArrivalState>({ key: null, kind: "watching" });
  const [fadingKey, setFadingKey] = useState<string | null>(null);
  const key = arrivalKey(vehicleId, selection);
  const activeKey = useRef(key);
  activeKey.current = key;
  const reloadedKey = useRef<string | null>(null);
  useEffect(() => {
    setState(previous => advanceArrival({ state: previous, vehicleId, selection, position, route, now, demo }));
  }, [vehicleId, selection, position, route, now, demo]);
  const reloadAt = state.key === key && state.kind === "arrived" ? state.reloadAt : null;
  useEffect(() => {
    if (reloadAt === null) return;
    const monotonicReloadAt = performance.now() + Math.max(0, reloadAt - Date.now());
    return scheduleArrivalReload({
      reloadAt: monotonicReloadAt, now: () => performance.now(),
      schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: timer => window.clearTimeout(timer),
      onFade: () => { if (activeKey.current === key) setFadingKey(key); },
      onReload: () => {
        if (activeKey.current !== key || reloadedKey.current === key) return;
        reloadedKey.current = key;
        window.location.reload();
      },
      onVisible: callback => {
        const change = () => { if (document.visibilityState === "visible") callback(); };
        document.addEventListener("visibilitychange", change);
        return () => document.removeEventListener("visibilitychange", change);
      },
    });
  }, [reloadAt, key]);
  return { arrived: reloadAt !== null, reloading: reloadAt !== null && fadingKey === key };
}
