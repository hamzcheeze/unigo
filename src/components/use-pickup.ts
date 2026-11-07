"use client";

import { useEffect, useRef, useState } from "react";
import { PICKUP_STOPS, nearestPickup, routeResponseSchema, type PickupSelection, type PickupStopId } from "@/lib/pickups";
import { freshness, type Position, type VehicleId } from "@/lib/domain";
import { PickupRouteCache, RouteUnavailableError } from "@/lib/pickup-route-cache";
import { estimateRemainingRoute } from "@/lib/route-estimate";
import { requestResidentLocation, type ResidentLocation } from "@/lib/resident-location";

type LocationState = { kind: "idle" | "searching" | "denied" | "unavailable" } | ResidentLocation;


export function usePickup({ position, vehicleId, now, demo }: { position: Position | null; vehicleId: VehicleId; now: number; demo: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(true);
  const [location, setLocation] = useState<LocationState>({ kind: "idle" });
  const [selection, setSelection] = useState<PickupSelection | null>(null);
  const locationRequest = useRef(0);
  const [routeCache] = useState(() => new PickupRouteCache(async ({ vehicleId, stopId }) => {
    const response = await fetch("/api/route", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId, stopId }), signal: AbortSignal.timeout(15000),
    }).catch(() => { throw new Error("โหลดเส้นทางไม่ได้ กรุณากดอัพเดตเส้นทางเพื่อลองใหม่"); });
    if (response.status === 503) throw new RouteUnavailableError();
    if (!response.ok) throw new Error("โหลดเส้นทางไม่ได้ กรุณากดอัพเดตเส้นทางเพื่อลองใหม่");
    const parsed = routeResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("ข้อมูลเส้นทางไม่ถูกต้อง กรุณากดอัพเดตเส้นทางเพื่อลองใหม่");
    return parsed.data;
  }));
  const [, renderRoutes] = useState(0);
  const cacheMount = useRef(0);
  useEffect(() => {
    const mount = ++cacheMount.current;
    return () => { queueMicrotask(() => {
      if (cacheMount.current === mount) routeCache.cancelRetries();
    }); };
  }, [routeCache]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    change(); document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) { setLocation({ kind: "unavailable" }); return; }
    const controller = new AbortController();
    const request = locationRequest.current;
    setLocation({ kind: "searching" });
    void requestResidentLocation({ geolocation: navigator.geolocation, signal: controller.signal }).then(result => {
      if (controller.signal.aborted || request !== locationRequest.current || result.kind === "cancelled") return;
      if (result.kind !== "located") { setLocation({ kind: result.kind }); return; }
      setLocation(result);
      const stop = nearestPickup(result);
      setSelection(previous => ({ stopId: stop.id, source: "nearest", revision: (previous?.revision ?? 0) + 1 }));
    });
    return () => controller.abort();
  }, [enabled, attempt]);
  const selected = PICKUP_STOPS.find(stop => stop.id === selection?.stopId) ?? null;
  const stopId = selected?.id ?? null;
  const live = Boolean(position && freshness(position, now).kind === "live" && position.accuracy_meters !== null && position.accuracy_meters <= 50);
  useEffect(() => {
    if (!stopId || demo || !live || !visible) return;
    let active = true;
    void routeCache.load({ vehicleId, stopId }).then(() => {
      if (active) renderRoutes(value => value + 1);
    });
    return () => { active = false; };
  }, [vehicleId, stopId, live, visible, demo, routeCache]);
  const entry = stopId ? routeCache.get({ vehicleId, stopId }) : undefined;
  const snapshot = entry?.kind === "ready" ? entry.snapshot : entry?.previousSnapshot ?? null;
  const route = snapshot?.route ?? null;
  const estimate = snapshot ? estimateRemainingRoute({ snapshot, position, now }) : null;
  let routeStatus = "เลือกจุดขึ้นรถเพื่อดูเส้นทาง";
  if (stopId) {
    if (demo) routeStatus = "โหมดตัวอย่างไม่คำนวณเวลาถึงจุดขึ้นรถ";
    else if (!live) routeStatus = "รอตำแหน่งรถที่ชัดเจนและเป็นปัจจุบัน";
    else if (entry?.kind === "loading") routeStatus = route ? "กำลังอัพเดตเส้นทาง..." : "กำลังหาเส้นทาง...";
    else if (entry?.kind === "error") routeStatus = entry.message;
    else if (estimate?.kind === "unavailable") {
      routeStatus = "รอตำแหน่งรถที่ชัดเจนและเป็นปัจจุบัน";
    } else if (estimate?.kind === "estimated") routeStatus = "";
    else routeStatus = visible ? "กำลังหาเส้นทาง..." : "รอกลับมาเปิดหน้าเว็บเพื่อหาเส้นทาง";
  }
  const refreshRoute = () => {
    if (!stopId || !live || demo) return;
    const request = routeCache.retry({ vehicleId, stopId });
    renderRoutes(value => value + 1);
    void request.then(() => renderRoutes(value => value + 1));
  };
  const select = (stopId: PickupStopId) => {
    locationRequest.current++;
    setEnabled(false);
    setLocation({ kind: "idle" });
    setSelection(previous => ({ stopId, source: "manual", revision: (previous?.revision ?? 0) + 1 }));
  };
  const locate = () => {
    locationRequest.current++;
    setLocation({ kind: "searching" });
    setEnabled(true);
    setAttempt(value => value + 1);
  };
  let locationMessage: string | null = null;
  if (location.kind === "searching") locationMessage = "กำลังหาตำแหน่งของคุณ";
  else if (location.kind === "denied") locationMessage = "ยังไม่ได้อนุญาตตำแหน่ง เลือกจุดขึ้นรถเองได้";
  else if (location.kind === "unavailable") locationMessage = "หาตำแหน่งไม่ได้ ลองใหม่หรือเลือกจุดขึ้นรถเอง";
  return { selected, selection, select, locate, locationMessage, route, estimate, routeStatus, refreshRoute, routeNotice: route && entry?.kind === "error" ? entry.message : null, routeLoading: entry?.kind === "loading" || Boolean(stopId && live && visible && !demo && !entry), canRefreshRoute: live && !demo };
}