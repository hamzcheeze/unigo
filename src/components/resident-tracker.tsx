"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { VEHICLES, positionSchema, mergePosition, freshness, type Position, type VehicleId } from "@/lib/domain";
import { VehicleMap } from "./vehicle-map";
import { BusIcon } from "./icons";
import { PICKUP_STOPS } from "@/lib/pickups";
import { usePickup } from "./use-pickup";

type Connection = "connecting" | "connected" | "reconnecting" | "offline" | "unconfigured" | "demo" | "usb";
const connectionLabels: Record<Connection, string> = {
  connecting: "กำลังเชื่อมต่อ", connected: "เชื่อมต่อแล้ว", reconnecting: "กำลังเชื่อมต่อใหม่",
  offline: "การเชื่อมต่อขัดข้อง", unconfigured: "ยังไม่ได้เชื่อมต่อ", demo: "ข้อมูลจำลอง", usb: "ทดสอบผ่าน USB",
};
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(supabaseUrl && supabaseKey);

function demoPosition(vehicleId: VehicleId, tick: number): Position | null {
  if (vehicleId === "SHUTTLE-03") return null;
  const offset = vehicleId === "SHUTTLE-01" ? 0 : 1.7;
  const phase = tick / 70 + offset;
  return positionSchema.parse({
    vehicle_id: vehicleId, revision: tick + 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: tick + 1,
    latitude: 13.7337 + Math.sin(phase) * .0018,
    longitude: 100.563 + Math.cos(phase) * .0026,
    accuracy_meters: vehicleId === "SHUTTLE-01" ? 8 : 17,
    speed_meters_per_second: 5.2,
    bearing_degrees: (phase * 180 / Math.PI + 90) % 360,
    captured_at: new Date().toISOString(), received_at: new Date().toISOString(),
  });
}

const usbEventSchema = z.object({ position: positionSchema.nullable(), connected: z.boolean(), error: z.string().nullable() });

function usePosition(vehicleId: VehicleId, demo: boolean, usb: boolean, refresh: number) {
  const [position, setPosition] = useState<Position | null>(null);
  const [connection, setConnection] = useState<Connection>(demo ? "demo" : configured ? "connecting" : "unconfigured");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const active = () => generation.current === currentGeneration;
    setPosition(null); setError(null);
    if (demo) {
      setConnection("demo");
      let tick = 1;
      const update = () => setPosition(demoPosition(vehicleId, tick++));
      update();
      const timer = window.setInterval(update, 1000);
      return () => { generation.current++; window.clearInterval(timer); };
    }
    if (usb) {
      if (vehicleId !== "SHUTTLE-01") { setConnection("usb"); return; }
      setConnection("connecting");
      const stream = new EventSource("/api/usb-positions");
      stream.onmessage = (event) => {
        if (!active()) return;
        try {
          const raw: unknown = JSON.parse(event.data);
          const parsed = usbEventSchema.safeParse(raw);
          if (!parsed.success) { setError("รูปแบบข้อมูล USB ไม่ถูกต้อง"); return; }
          const value = parsed.data;
          setConnection(value.connected ? "usb" : "offline");
          setError(value.error);
          if (value.position?.vehicle_id === vehicleId) setPosition(value.position);
        } catch { setError("อ่านข้อมูล GPS ผ่าน USB ไม่ได้"); }
      };
      stream.onerror = () => { if (active()) { setConnection("reconnecting"); setError("การเชื่อมต่อ USB ขาดหาย กำลังลองใหม่"); } };
      return () => { generation.current++; stream.close(); };
    }
    if (!supabaseUrl || !supabaseKey) { setConnection("unconfigured"); return; }
    setConnection("connecting");
    const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const accept = (value: unknown) => {
      const parsed = positionSchema.safeParse(value);
      if (!active()) return;
      if (!parsed.success || parsed.data.vehicle_id !== vehicleId) { setError("รูปแบบข้อมูลตำแหน่งไม่ถูกต้อง"); return; }
      setPosition((previous) => mergePosition(previous, parsed.data));
      setError(null);
    };
    const fetchSnapshot = async () => {
      const result = await client.from("vehicle_positions").select("*").eq("vehicle_id", vehicleId).maybeSingle();
      if (!active()) return;
      if (result.error) { setError("โหลดตำแหน่งล่าสุดไม่ได้ กรุณาลองเชื่อมต่อใหม่"); return; }
      if (result.data) accept(result.data);
    };
    const channel = client.channel("vehicle:" + vehicleId)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_positions", filter: "vehicle_id=eq." + vehicleId }, (payload) => accept(payload.new))
      .subscribe((status) => {
        if (!active()) return;
        if (status === "SUBSCRIBED") { setConnection("connected"); void fetchSnapshot(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection(navigator.onLine ? "reconnecting" : "offline");
        else if (status === "CLOSED") setConnection("offline");
      });
    const onVisible = () => { if (document.visibilityState === "visible" && active()) setRecovery((value) => value + 1); };
    const onOnline = () => { if (active()) { setConnection("reconnecting"); setRecovery((value) => value + 1); } };
    const onOffline = () => { if (active()) setConnection("offline"); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline);
      void client.removeChannel(channel);
    };
  }, [vehicleId, demo, usb, refresh, recovery]);
  return { position: position?.vehicle_id === vehicleId ? position : null, connection, error };
}

function ageLabel(seconds: number | null) {
  if (seconds === null) return "ยังไม่มีข้อมูล";
  if (seconds < 1) return "เมื่อสักครู่";
  if (seconds < 60) return Math.floor(seconds) + " วินาทีที่แล้ว";
  if (seconds < 3600) return Math.floor(seconds / 60) + " นาทีที่แล้ว";
  return Math.floor(seconds / 3600) + " ชั่วโมงที่แล้ว";
}
function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });
}

export function ResidentTracker({ demo, usb = false }: { demo: boolean; usb?: boolean }) {
  const [selectedId, setSelectedId] = useState<VehicleId>("SHUTTLE-01");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(0);
  const vehicle = VEHICLES.find((item) => item.id === selectedId) ?? VEHICLES[0];
  const { position, connection, error } = usePosition(selectedId, demo, usb, refresh);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const quality = freshness(position, now || Date.now());
  const pickup = usePickup({ position, vehicleId: selectedId, now: now || Date.now(), demo: demo || usb });
  const poorGps = position !== null && (position.accuracy_meters === null || position.accuracy_meters > 30);
  const isLive = quality.kind === "live";
  const status = !position ? "ยังไม่มีตำแหน่ง" : !isLive ? "ขาดการอัปเดต" : poorGps ? "สัญญาณ GPS ไม่ชัด" : "อัปเดตตำแหน่งสด";
  const number = selectedId.slice(-1);
  const reconnect = useCallback(() => setRefresh((value) => value + 1), []);

  return <main className="site">
    <header className="header">
      <h1 className="header-title"><span className="header-name">UNiO Charan 3</span>{" "}<span className="header-descriptor">รถชมพู</span></h1>
      <div className={"connection connection-" + connection} role="status"><span className="small-dot" />{connectionLabels[connection]}</div>
    </header>

    {usb && <div className="demo-banner"><span><strong>ทดสอบผ่าน USB</strong> เชื่อมต่อเฉพาะรถคันที่ 1</span><a href="/">ดูระบบจริง</a></div>}
    {demo && <div className="demo-banner"><span><strong>ข้อมูลจำลอง</strong> ตำแหน่งและการเคลื่อนที่ใช้สำหรับสาธิต</span><a href="/">ดูรถจริง</a></div>}

    <nav className="vehicle-tabs" aria-label="เลือกรถรับส่ง">
      {VEHICLES.map((item) => <button key={item.id} className={"vehicle-tab " + (selectedId === item.id ? "selected" : "")} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
        <BusIcon size={20}/><span>{item.label}</span>
      </button>)}
    </nav>

    <section className="pickup-panel" aria-labelledby="pickup-heading">
      <div className="pickup-heading"><h2 id="pickup-heading">ขึ้นรถกลับคอนโด</h2><button className="locate-pickup" onClick={pickup.locate}>หาจุดขึ้นรถใกล้ฉัน</button></div>
      <p role="status">{pickup.locationMessage}</p>
      <p className="pickup-privacy">ใช้ตำแหน่งบนเครื่องของคุณเท่านั้น ไม่ส่งพิกัดของคุณไปยังเซิร์ฟเวอร์</p>
      <div className="pickup-options">{PICKUP_STOPS.map(stop => <button key={stop.id} aria-pressed={pickup.selected?.id === stop.id} onClick={() => pickup.select(stop.id)}>{stop.label}</button>)}</div>
      {pickup.selected && <div className="pickup-eta" role="status"><strong>{pickup.manual ? "จุดที่เลือก" : "จุดขึ้นรถใกล้คุณ"} · {pickup.selected.label}</strong>{pickup.route ? <><span className="eta-number">ประมาณ {Math.max(1, Math.ceil(pickup.route.durationSeconds / 60))} นาที</span><span>{(pickup.route.distanceMeters / 1000).toFixed(1)} กม. ตามเส้นทางถนน</span><small>คำนวณตามการจราจร ไม่รวมเวลาจอดรับคน เส้นทางจริงของรถอาจต่างออกไป</small><small>เส้นทางและเวลาโดย <a href="https://www.tomtom.com/" target="_blank" rel="noreferrer">TomTom</a></small></> : <span>{pickup.routeStatus || "กำลังอัปเดตเส้นทาง"}</span>}</div>}
    </section>

    <section className="tracker-layout" aria-label="ตำแหน่งรถที่เลือก">
      <VehicleMap key={selectedId} position={position} color={vehicle.color} number={number} stale={!isLive} pickupId={pickup.selected?.id ?? null} route={pickup.route}/>
      <div className="vehicle-panel">
        <div className="status-strip">
          <div className="vehicle-status"><h2>{vehicle.label}</h2><div className={"gps-status " + (!position ? "waiting" : isLive && !poorGps ? "fresh" : "stale")} role="status"><span className="small-dot"/><strong>{status}</strong><span>{position && quality.ageSeconds === null ? "ตรวจสอบเวลาในอุปกรณ์" : ageLabel(quality.ageSeconds)}</span></div></div>
          {position && <dl className="metrics"><div><dt>ความเร็ว</dt><dd>{position.speed_meters_per_second === null ? "ไม่ทราบ" : Math.round(position.speed_meters_per_second * 3.6)}{position.speed_meters_per_second !== null && <small> กม./ชม.</small>}</dd></div><div><dt>ความแม่นยำโดยประมาณ</dt><dd>{position.accuracy_meters === null ? "ไม่ทราบ" : Math.round(position.accuracy_meters)}{position.accuracy_meters !== null && <small> เมตร</small>}</dd></div></dl>}
        </div>

        {connection === "unconfigured" ? <div className="setup-note"><p>ยังไม่ได้เชื่อมต่อระบบพิกัด</p><a className="demo-link" href="/?demo=1">ดูตัวอย่าง</a></div> :
          !position ? <p className="waiting-note">{usb && selectedId !== "SHUTTLE-01" ? "โหมด USB เชื่อมเฉพาะรถคันที่ 1" : demo && selectedId === "SHUTTLE-03" ? "ตัวอย่างรถที่ยังไม่ได้ส่งพิกัด" : "ยังไม่ได้รับพิกัดจากรถคันนี้"}</p> :
          <>
            {!isLive && <p className="warning-copy">ยังไม่ได้รับพิกัดใหม่ ตำแหน่งรถอาจเปลี่ยนแล้ว</p>}
            <div className="position-summary"><p></p><details className="position-disclosure"><summary>รายละเอียดพิกัด</summary><dl className="position-details"><div><dt>GPS บันทึกเมื่อ</dt><dd>{timeLabel(position.captured_at)} น.</dd></div><div><dt>ระบบรับข้อมูลเมื่อ</dt><dd>{timeLabel(position.received_at)} น.</dd></div><div><dt>ละติจูด / ลองจิจูด</dt><dd className="coordinates">{position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}</dd></div></dl></details></div>
          </>}
        {error && <p className="error-copy" role="alert">{error}</p>}
        {(connection === "offline" || connection === "reconnecting" || error) && <button className="reconnect-button" onClick={reconnect}>เชื่อมต่อใหม่</button>}
      </div>
    </section>

    <section className="stop-list" aria-labelledby="stops-heading"><h2 id="stops-heading">จุดขึ้นรถกลับคอนโด</h2><ul>{PICKUP_STOPS.map(stop => <li key={stop.id}>{stop.label}</li>)}</ul></section>
  </main>;
}
