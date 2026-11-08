import { z } from "zod";
import type { Position, VehicleId } from "@/lib/domain";
import { PICKUP_STOPS, type PickupSelection, type PickupStopId, type RoadRoute } from "@/lib/pickups";
import type { usePickup } from "./use-pickup";

export const demoScenarioSchema = z.enum([
  "initial", "estimated", "near", "arrived", "loading", "refreshing", "no-gps", "stale-gps", "inaccurate-gps",
  "route-error", "route-data-error", "route-mismatch", "route-cancelled", "waiting-tab", "position-invalid", "provider-unavailable", "refresh-error", "distance-unavailable", "offline", "reconnecting", "unconfigured",
  "position-error", "searching", "denied", "location-unavailable", "map-loading", "map-error", "tile-error",
]);
export type DemoScenario = z.infer<typeof demoScenarioSchema>;
export const DEMO_SCENARIOS = {
  initial: "หน้าแรก ก่อนเลือกจุดขึ้นรถ", estimated: "เวลาถึงและระยะทาง", near: "รถใกล้จะมาถึงแล้ว", arrived: "รถมาถึงแล้ว",
  loading: "กำลังหาเส้นทาง", refreshing: "กำลังอัพเดตเส้นทาง", "no-gps": "ยังไม่มีตำแหน่งรถ",
  "stale-gps": "พิกัดรถเก่า", "inaccurate-gps": "GPS รถคลาดเคลื่อนสูง", "route-error": "โหลดเส้นทางไม่ได้",
  "route-data-error": "ข้อมูลเส้นทางไม่ถูกต้อง", "route-mismatch": "เส้นทางไม่ตรงกับรถหรือจุดขึ้นรถ", "route-cancelled": "หยุดอัพเดตเส้นทาง", "waiting-tab": "รอกลับมาเปิดหน้าเว็บ", "position-invalid": "ข้อมูลตำแหน่งไม่ถูกต้อง",
  "provider-unavailable": "ผู้ให้บริการเส้นทางยังไม่พร้อม", "refresh-error": "อัพเดตเส้นทางไม่สำเร็จ มีข้อมูลเดิม",
  "distance-unavailable": "ประเมินระยะทางไม่ได้", offline: "การเชื่อมต่อขาดหาย", reconnecting: "กำลังเชื่อมต่อใหม่",
  unconfigured: "ยังไม่ได้เชื่อมต่อระบบพิกัด", "position-error": "โหลดตำแหน่งล่าสุดไม่ได้",
  searching: "กำลังหาตำแหน่งของคุณ", denied: "ไม่ได้อนุญาตตำแหน่ง", "location-unavailable": "หาตำแหน่งของคุณไม่ได้",
  "map-loading": "กำลังเปิดแผนที่", "map-error": "เปิดแผนที่ไม่ได้", "tile-error": "โหลดพื้นแผนที่ไม่ครบ",
} satisfies Record<DemoScenario, string>;
export type MapPreview = "normal" | "loading" | "error" | "tiles";

export function demoState({ scenario, vehicleId, stopId, selection, now, select, locate, refreshRoute }: {
  scenario: DemoScenario; vehicleId: VehicleId; stopId: PickupStopId; selection: PickupSelection | null; now: number;
  select: (id: PickupStopId) => void; locate: () => void; refreshRoute: () => void;
}): { pickup: ReturnType<typeof usePickup>; position: Position | null; connection: "demo" | "offline" | "reconnecting" | "unconfigured"; error: string | null; mapPreview: MapPreview } {
  const stop = PICKUP_STOPS.find(item => item.id === stopId) ?? PICKUP_STOPS[0];
  const selected = scenario === "initial" ? null : stop;
  const near = scenario === "near" || scenario === "arrived";
  const point: [number, number] = near ? [stop.latitude + .0001, stop.longitude] : [13.731144, 100.466352];
  const captured = new Date(now - (scenario === "stale-gps" ? 30000 : 0)).toISOString();
  const position: Position | null = scenario === "no-gps" || scenario === "unconfigured" ? null : {
    vehicle_id: vehicleId, revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1,
    latitude: point[0], longitude: point[1], accuracy_meters: scenario === "inaccurate-gps" ? 80 : 5,
    speed_meters_per_second: near ? 0 : 5, bearing_degrees: 90, captured_at: captured, received_at: captured,
  };
  const route: RoadRoute = { vehicleId, stopId: stop.id, sourceRevision: 1, points: near ? [point, [stop.latitude, stop.longitude]] : [point, [13.729377, 100.474142], [stop.latitude, stop.longitude]],
    distanceMeters: near ? 20 : 1700, durationSeconds: near ? 60 : 480, fetchedAt: captured, trafficAware: true, provider: "tomtom" };
  const waiting = ["no-gps", "stale-gps", "inaccurate-gps", "unconfigured"].some(value => value === scenario);
  const routeErrors: Partial<Record<DemoScenario, string>> = {
    "route-error": "โหลดเส้นทางไม่ได้ กรุณากดอัพเดตเส้นทางเพื่อลองใหม่",
    "route-data-error": "ข้อมูลเส้นทางไม่ถูกต้อง กรุณากดอัพเดตเส้นทางเพื่อลองใหม่",
    "route-mismatch": "ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก",
    "route-cancelled": "หยุดการอัพเดตเส้นทางแล้ว",
    "provider-unavailable": "ยังไม่พร้อมแสดงเส้นทางและเวลาถึง",
    "waiting-tab": "รอกลับมาเปิดหน้าเว็บเพื่อหาเส้นทาง",
  };
  const failure = routeErrors[scenario] !== undefined;
  const routeLoading = waiting || scenario === "waiting-tab" || scenario === "loading" || scenario === "refreshing";
  const arrived = scenario === "arrived";
  const routeError = "โหลดเส้นทางไม่ได้ กรุณากดอัพเดตเส้นทางเพื่อลองใหม่";
  return {
    position,
    connection: scenario === "offline" || scenario === "reconnecting" || scenario === "unconfigured" ? scenario : "demo",
    error: scenario === "position-invalid" ? "รูปแบบข้อมูลตำแหน่งไม่ถูกต้อง" : scenario === "position-error" ? "โหลดตำแหน่งล่าสุดไม่ได้ กรุณาลองเชื่อมต่อใหม่" : null,
    mapPreview: scenario === "map-loading" ? "loading" : scenario === "map-error" ? "error" : scenario === "tile-error" ? "tiles" : "normal",
    pickup: {
      selected, selection, select, locate, refreshRoute, locating: scenario === "searching",
      arrived, reloading: false, route: selected && !waiting && !failure && scenario !== "loading" ? route : null,
      estimate: selected && !waiting && !failure && !routeLoading ? { kind: "estimated", remainingMinutes: near ? 1 : 8, distanceMeters: scenario === "distance-unavailable" ? null : near ? 20 : 1700 } : null,
      routeLoading, routeRefreshing: scenario === "refreshing", canRefreshRoute: Boolean(selected && !waiting && !arrived && (!routeLoading || scenario === "refreshing")),
      routeStatus: waiting ? "รอตำแหน่งรถที่ชัดเจนและเป็นปัจจุบัน" : routeErrors[scenario] ?? "กำลังหาเส้นทาง...",
      routeNotice: scenario === "refresh-error" ? routeError : null,
      locationMessage: scenario === "denied" ? "ยังไม่ได้อนุญาตตำแหน่ง เลือกจุดขึ้นรถเองได้" : scenario === "location-unavailable" ? "หาตำแหน่งไม่ได้ ลองใหม่หรือเลือกจุดขึ้นรถเอง" : null,
    },
  };
}
