"use client";

import { useEffect, useRef, useState } from "react";
import { PICKUP_STOPS, nearestPickup, routeResponseSchema, type PickupSelection, type PickupStopId, type RoadRoute } from "@/lib/pickups";
import { isFreshLocation } from "@/lib/geofence";
import { freshness, type Position, type VehicleId } from "@/lib/domain";

type LocationState = { kind: "idle" | "searching" | "denied" | "unavailable" } | { kind: "located"; latitude: number; longitude: number; accuracy: number; timestamp: number };


export function usePickup({ position, vehicleId, now, demo }: { position: Position | null; vehicleId: VehicleId; now: number; demo: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(true);
  const [location, setLocation] = useState<LocationState>({ kind: "idle" });
  const [selection, setSelection] = useState<PickupSelection | null>(null);
  const locationRequest = useRef(0);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState("เลือกจุดขึ้นรถเพื่อดูเส้นทาง");
  const lastRequests = useRef(new Map<string, number>());
  const latestPosition = useRef(position);
  latestPosition.current = position;
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    change(); document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!enabled) { setLocation({ kind: "idle" }); return; }
    if (!navigator.geolocation) { setLocation({ kind: "unavailable" }); return; }
    let active = true;
    const request = locationRequest.current;
    setLocation({ kind: "searching" });
    navigator.geolocation.getCurrentPosition((value) => {
      if (!active || request !== locationRequest.current) return;
      const { latitude, longitude, accuracy } = value.coords;
      if (![latitude, longitude, accuracy, value.timestamp].every(Number.isFinite) || accuracy < 0 || !isFreshLocation(value.timestamp, Date.now()) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { setLocation({ kind: "unavailable" }); return; }
      setLocation({ kind: "located", latitude, longitude, accuracy, timestamp: value.timestamp });
      const stop = nearestPickup({ latitude, longitude });
      setSelection(previous => ({ stopId: stop.id, source: "nearest", revision: (previous?.revision ?? 0) + 1 }));
    }, (error) => { if (active && request === locationRequest.current) setLocation({ kind: error.code === 1 ? "denied" : "unavailable" }); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    return () => { active = false; };
  }, [enabled, attempt]);
  const fix = visible && location.kind === "located" && isFreshLocation(location.timestamp, now) ? location : null;
  const selected = PICKUP_STOPS.find(stop => stop.id === selection?.stopId) ?? null;
  const stopId = selected?.id ?? null;
  const live = Boolean(position && freshness(position, now).kind === "live" && position.accuracy_meters !== null && position.accuracy_meters <= 50);
  useEffect(() => {
    setRoute(null);
    if (!stopId) { setRouteStatus("เลือกจุดขึ้นรถเพื่อดูเส้นทาง"); return; }
    if (demo) { setRouteStatus("โหมดตัวอย่างไม่คำนวณเวลาถึงจุดขึ้นรถ"); return; }
    if (!live || !visible) { setRouteStatus("รอตำแหน่งรถที่ชัดเจนและเป็นปัจจุบัน"); return; }
    setRouteStatus("รออัปเดตเส้นทางรอบถัดไป");
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight || !active || !latestPosition.current || freshness(latestPosition.current).kind !== "live") return;
      const key = vehicleId + ":" + stopId;
      if (Date.now() - (lastRequests.current.get(key) ?? 0) < 30000) return;
      lastRequests.current.set(key, Date.now());
      inFlight = true;
      setRouteStatus("กำลังหาเส้นทาง");
      try {
        const response = await fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleId, stopId }), signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 503 ? "ยังไม่พร้อมแสดงเส้นทางและเวลาถึง" : "โหลดเส้นทางไม่ได้ กำลังลองใหม่");
        const value = routeResponseSchema.parse(await response.json());
        if (active && value.vehicleId === vehicleId && value.stopId === stopId) { setRoute(value); setRouteStatus(""); }
      } catch (error) { if (active) { setRoute(null); setRouteStatus(error instanceof Error && error.message.startsWith("ยังไม่พร้อม") ? error.message : "โหลดเส้นทางไม่ได้ กำลังลองใหม่"); } }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [vehicleId, stopId, live, visible, demo]);
  const validRoute = live && visible && route?.vehicleId === vehicleId && route.stopId === stopId && now - Date.parse(route.fetchedAt) <= 60000 && Date.parse(route.fetchedAt) - now <= 5000 ? route : null;
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
  let locationMessage = "ใช้ตำแหน่งของคุณเพื่อหาจุดขึ้นรถที่ใกล้ที่สุด";
  if (location.kind === "searching") locationMessage = "กำลังหาตำแหน่งของคุณ";
  else if (location.kind === "denied") locationMessage = "ยังไม่ได้อนุญาตตำแหน่ง เลือกจุดขึ้นรถเองได้";
  else if (location.kind === "unavailable") locationMessage = "หาตำแหน่งไม่ได้ ลองใหม่หรือเลือกจุดขึ้นรถเอง";
  else if (fix && selection?.source === "nearest" && selected) locationMessage = "จุดขึ้นรถที่ใกล้ที่สุด · " + selected.label + (fix.accuracy > 50 ? " · พิกัดเครื่องคลาดเคลื่อนสูง" : "");
  else if (enabled && location.kind === "located") locationMessage = "ตำแหน่งของคุณเก่าแล้ว กดค้นหาอีกครั้งเพื่อใช้พิกัดใหม่";
  return { selected, selection, select, locate, locationMessage, route: validRoute, routeStatus };
}
