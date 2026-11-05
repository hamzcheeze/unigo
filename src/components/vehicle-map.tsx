"use client";

import { useEffect, useRef, useState } from "react";
import type { Map, Marker, Circle } from "leaflet";
import type { Position } from "@/lib/domain";
import { TargetIcon, PinIcon } from "./icons";

type Props = { position: Position | null; color: string; number: string; stale: boolean };
type Leaflet = typeof import("leaflet");

export function VehicleMap({ position, color, number, stale }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const marker = useRef<Marker | null>(null);
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
      const instance = L.map(element.current, { zoomControl: false }).setView([13.75, 100.5], 14);
      map.current = instance; library.current = L;
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
      }).addTo(instance);
      tiles.on("tileerror", () => setTileError(true));
      tiles.on("tileload", () => setTileError(false));
      instance.on("dragstart", () => { followRef.current = false; setFollow(false); });
      setReady(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; marker.current = null; circle.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const L = library.current;
    if (!ready || !instance || !L) return;
    if (!position) {
      marker.current?.remove(); marker.current = null;
      circle.current?.remove(); circle.current = null;
      lastVehicle.current = null;
      return;
    }
    const point: [number, number] = [position.latitude, position.longitude];
    const actualColor = stale ? "#73847f" : color;
    const html = '<span class="bus-pin" style="--bus-color:' + actualColor + '"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5 10h14M8 19v2m8-2v2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="15" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15" r="1.2" fill="currentColor"/></svg><b>' + number + '</b></span>';
    const icon = L.divIcon({ html, className: "vehicle-pin", iconSize: [58, 58], iconAnchor: [29, 29] });
    if (marker.current) marker.current.setLatLng(point).setIcon(icon);
    else marker.current = L.marker(point, { icon, title: "รถคันที่ " + number }).addTo(instance);
    if (position.accuracy_meters !== null) {
      if (!circle.current) circle.current = L.circle(point, { radius: position.accuracy_meters, color: actualColor, fillOpacity: .10, weight: 1 }).addTo(instance);
      else circle.current.setLatLng(point).setRadius(position.accuracy_meters).setStyle({ color: actualColor });
    } else { circle.current?.remove(); circle.current = null; }
    if (lastVehicle.current !== position.vehicle_id) {
      instance.setView(point, 16, { animate: false }); lastVehicle.current = position.vehicle_id; followRef.current = true; setFollow(true);
    } else if (followRef.current) instance.panTo(point, { animate: false });
  }, [position, ready, color, number, stale]);

  return <div className="map-shell">
    <div ref={element} className="map-canvas" aria-label="แผนที่ตำแหน่งรถคันที่เลือก" />
    {(!ready || error) && <div className="map-cover"><span className="map-cover-icon">◎</span><strong>{error ? "เปิดแผนที่ไม่ได้" : "กำลังเปิดแผนที่"}</strong><p>{error ? "ยังดูพิกัดและเวลาอัปเดตจากการ์ดด้านข้างได้" : "รอสักครู่"}</p></div>}
    {ready && !position && <div className="map-empty"><PinIcon size={30} /><strong>รอตำแหน่งรถคันนี้</strong><span>เมื่อคนขับเริ่มให้บริการ ตำแหน่งจะแสดงที่นี่</span></div>}
    {tileError && <div className="map-warning" role="status">โหลดพื้นแผนที่ไม่ครบ กรุณาตรวจสอบอินเทอร์เน็ต</div>}
    <div className="map-caption"><span className={position && !stale ? "small-dot" : "small-dot muted"} />{position ? stale ? "ตำแหน่งล่าสุดที่ได้รับ" : "ตำแหน่งจาก GPS ของรถ" : "ยังไม่มีตำแหน่งรถ"}</div>
    <button className={"follow-button " + (follow ? "following" : "")} disabled={!position} onClick={() => { if (!position) return; followRef.current = true; setFollow(true); map.current?.setView([position.latitude, position.longitude], 16); }}><TargetIcon />{follow ? "ติดตามรถ" : "กลับไปที่รถ"}</button>
  </div>;
}
