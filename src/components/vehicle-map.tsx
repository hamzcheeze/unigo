"use client";

import { useEffect, useRef, useState } from "react";
import type { Map, Marker, Circle, Polyline } from "leaflet";
import { PICKUP_STOPS, type PickupSelection, type RoadRoute } from "@/lib/pickups";
import type { Position } from "@/lib/domain";
import { TargetIcon } from "./icons";
import { remainingRoute } from "@/lib/remaining-route";

type Props = { position: Position | null; color: string; number: string; stale: boolean; selection: PickupSelection | null; route: RoadRoute | null };
type Leaflet = typeof import("leaflet");

export function VehicleMap({ position, color, number, stale, selection, route }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const latestPosition = useRef(position);
  latestPosition.current = position;
  const fittedSelection = useRef<PickupSelection | null>(null);
  const routeFitPending = useRef(false);
  const map = useRef<Map | null>(null);
  const marker = useRef<Marker | null>(null);
  const markerAppearance = useRef<string | null>(null);
  const routeLine = useRef<Polyline | null>(null);
  const drawnRoute = useRef<RoadRoute | null>(null);
  const circle = useRef<Circle | null>(null);
  const library = useRef<Leaflet | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [follow, setFollow] = useState(true);
  const [tileError, setTileError] = useState(false);
  const followRef = useRef(true);
  const lastVehicle = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const instance = L.map(element.current, { zoomControl: false }).setView([13.722, 100.475], 14);
      instance.fitBounds(PICKUP_STOPS.map(stop => [stop.latitude, stop.longitude]), { padding: [65, 65] });
      map.current = instance; library.current = L;
      for (const stop of PICKUP_STOPS) {
        L.circleMarker([stop.latitude, stop.longitude], { radius: 8, color: "#fff", weight: 3, fillColor: "#48102b", fillOpacity: 1 }).addTo(instance).bindTooltip(stop.label, { permanent: true, direction: "top", className: "pickup-label" });
        L.circle([stop.latitude, stop.longitude], { radius: 50, color: "#c90060", weight: 1, fillOpacity: .04 }).addTo(instance);
      }
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
      }).addTo(instance);
      tiles.on("tileerror", () => setTileError(true));
      tiles.on("tileload", () => setTileError(false));
      instance.on("dragstart", () => { routeFitPending.current = false; followRef.current = false; setFollow(false); });
      setReady(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; marker.current = null; circle.current = null; routeLine.current = null; drawnRoute.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const L = library.current;
    if (!ready || !instance || !L) return;
    if (!position) {
      marker.current?.remove(); marker.current = null; markerAppearance.current = null;
      circle.current?.remove(); circle.current = null;
      lastVehicle.current = null;
      return;
    }
    const point: [number, number] = [position.latitude, position.longitude];
    const actualColor = stale ? "#8D7882" : color;
    const html = '<span class="bus-pin" style="--bus-color:' + actualColor + '"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5 10h14M8 19v2m8-2v2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="15" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15" r="1.2" fill="currentColor"/></svg>' + (stale ? '' : '<span class="bus-online-dot" role="img" aria-label="กำลังส่งพิกัด"></span>') + '</span>';
    const appearance = actualColor + ":" + number + ":" + stale;
    marker.current?.setLatLng(point);
    if (!marker.current || markerAppearance.current !== appearance) {
      const icon = L.divIcon({ html, className: "vehicle-pin", iconSize: [36, 36], iconAnchor: [18, 18] });
      if (marker.current) marker.current.setIcon(icon);
      else marker.current = L.marker(point, { icon, title: "คันที่ " + number }).addTo(instance);
      markerAppearance.current = appearance;
    }
    if (position.accuracy_meters !== null) {
      if (!circle.current) circle.current = L.circle(point, { radius: position.accuracy_meters, color: actualColor, fillOpacity: .10, weight: 1 }).addTo(instance);
      else circle.current.setLatLng(point).setRadius(position.accuracy_meters).setStyle({ color: actualColor });
    } else { circle.current?.remove(); circle.current = null; }
    if (lastVehicle.current !== position.vehicle_id) {
      if (!selection) {
        const bounds: [number, number][] = PICKUP_STOPS.map(value => [value.latitude, value.longitude]);
        instance.fitBounds([...bounds, point], { padding: [65, 65], maxZoom: 16 });
        followRef.current = false; setFollow(false);
      }
      lastVehicle.current = position.vehicle_id;
    } else if (followRef.current) instance.panTo(point, { animate: false });
  }, [position, ready, color, number, stale, selection]);

  useEffect(() => {
    const instance = map.current;
    const L = library.current;
    if (!ready || !instance || !L) return;
    if (!route) {
      routeLine.current?.remove(); routeLine.current = null; drawnRoute.current = null;
      return;
    }
    const progress = remainingRoute({ route, position: stale ? null : position, now: Date.now() });
    if (!progress && drawnRoute.current === route) return;
    const displayed = progress?.points ?? route.points;
    if (routeLine.current) routeLine.current.setLatLngs(displayed);
    else routeLine.current = L.polyline(displayed, { color: "#c90060", weight: 5, opacity: .85 }).addTo(instance);
    drawnRoute.current = route;
  }, [route, position, stale, ready]);

  useEffect(() => {
    const instance = map.current;
    const vehiclePosition = latestPosition.current;
    const stop = PICKUP_STOPS.find(value => value.id === selection?.stopId);
    if (!ready || !instance || !stop || !selection || !vehiclePosition) return;
    const newSelection = fittedSelection.current !== selection;
    const selectedRoute = route?.stopId === stop.id && route.vehicleId === vehiclePosition.vehicle_id ? route : null;
    if (newSelection) {
      fittedSelection.current = selection;
      routeFitPending.current = true;
    }
    if (!newSelection && !(selectedRoute && routeFitPending.current)) return;
    const bounds: [number, number][] = [
      [vehiclePosition.latitude, vehiclePosition.longitude],
      [stop.latitude, stop.longitude],
      ...(selectedRoute?.points ?? []),
    ];
    followRef.current = false; setFollow(false);
    instance.stop().fitBounds(bounds, { padding: [65, 65], maxZoom: 16 });
    if (selectedRoute) routeFitPending.current = false;
  }, [selection, route, ready]);

  return <div className="map-shell">
    <div ref={element} className="map-canvas" aria-label="แผนที่ตำแหน่งรถคันที่เลือก" />
    {(!ready || error) && <div className="map-cover"><span className="map-cover-icon">◎</span><strong>{error ? "เปิดแผนที่ไม่ได้" : "กำลังเปิดแผนที่"}</strong><p>{error ? "ดูสถานะพิกัดและเวลาอัพเดตด้านล่างได้" : "รอสักครู่"}</p></div>}
    {tileError && <div className="map-warning" role="status">โหลดพื้นแผนที่ไม่ครบ กรุณาตรวจสอบอินเทอร์เน็ต</div>}
    <div className="map-caption"><span className={position && !stale ? "small-dot" : "small-dot muted"} />{position ? stale ? "ตำแหน่งล่าสุดที่ได้รับ" : "ตำแหน่งจาก GPS ของรถ" : "ยังไม่มีตำแหน่งรถ"}</div>
    <button className={"follow-button " + (follow ? "following" : "")} disabled={!position} onClick={() => { if (!position) return; routeFitPending.current = false; followRef.current = true; setFollow(true); map.current?.setView([position.latitude, position.longitude], 16); }}><TargetIcon />{follow ? "ติดตามตำแหน่ง" : "กลับไปที่รถ"}</button>
  </div>;
}
