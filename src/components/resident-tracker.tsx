"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { VEHICLES, vehicleIdSchema, positionSchema, mergePosition, freshness, type Position, type VehicleId } from "@/lib/domain";
import { VehicleMap } from "./vehicle-map";
import { BusIcon } from "./icons";
import { PICKUP_STOPS } from "@/lib/pickups";
import { usePickup } from "./use-pickup";
import { DEMO_SCENARIOS, demoScenarioSchema, demoState, type DemoScenario } from "./demo-scenarios";
import type { PickupSelection, PickupStopId } from "@/lib/pickups";

type Connection = "connecting" | "connected" | "reconnecting" | "offline" | "unconfigured" | "demo" | "usb";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(supabaseUrl && supabaseKey);

const usbEventSchema = z.object({ position: positionSchema.nullable(), connected: z.boolean(), error: z.string().nullable() });

function usePosition(vehicleId: VehicleId, demo: boolean, usb: boolean, refresh: number) {
  const [positions, setPositions] = useState<Partial<Record<VehicleId, Position>>>({});
  const [connection, setConnection] = useState<Connection>(demo ? "demo" : configured ? "connecting" : "unconfigured");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const active = () => generation.current === currentGeneration;
    setPositions({}); setError(null);
    if (demo) {
      setConnection("demo");
      return;
    }
    if (usb) {
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
          if (value.position?.vehicle_id === "SHUTTLE-01") setPositions({ "SHUTTLE-01": value.position });
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
      if (!parsed.success) { setError("รูปแบบข้อมูลตำแหน่งไม่ถูกต้อง"); return; }
      setPositions(previous => ({ ...previous, [parsed.data.vehicle_id]: mergePosition(previous[parsed.data.vehicle_id] ?? null, parsed.data) }));
      setError(null);
    };
    const fetchSnapshot = async () => {
      const result = await client.from("vehicle_positions").select("*");
      if (!active()) return;
      if (result.error) { setError("โหลดตำแหน่งล่าสุดไม่ได้ กรุณาลองเชื่อมต่อใหม่"); return; }
      for (const value of result.data ?? []) accept(value);
    };
    const channel = client.channel("vehicles")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_positions" }, (payload) => {
        if (!active()) return;
        if (payload.eventType !== "DELETE") { accept(payload.new); return; }
        const id = vehicleIdSchema.safeParse(payload.old.vehicle_id);
        if (id.success) setPositions(previous => {
          const next = { ...previous };
          delete next[id.data];
          return next;
        });
      })
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
  }, [demo, usb, refresh, recovery]);
  return { position: positions[vehicleId] ?? null, connection, error };
}

export function ResidentTracker({ demo, usb = false, initialDemoScenario = "initial" }: { demo: boolean; usb?: boolean; initialDemoScenario?: DemoScenario }) {
  const [scenario, setScenario] = useState(initialDemoScenario);
  const [demoStopId, setDemoStopId] = useState<PickupStopId>("talat-phlu");
  const [demoRevision, setDemoRevision] = useState(1);
  const [selectedId, setSelectedId] = useState<VehicleId>("SHUTTLE-01");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(0);
  const vehicle = VEHICLES.find((item) => item.id === selectedId) ?? VEHICLES[0];
  const livePosition = usePosition(selectedId, demo, usb, refresh);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const livePickup = usePickup({ position: livePosition.position, vehicleId: selectedId, now: now || Date.now(), demo: demo || usb });
  const demoSelection = useMemo<PickupSelection | null>(() => scenario === "initial" ? null : { stopId: demoStopId, source: "manual", revision: demoRevision }, [scenario, demoStopId, demoRevision]);
  const preview = demo ? demoState({ scenario, vehicleId: selectedId, stopId: demoStopId, selection: demoSelection, now: now || Date.now(),
    select: id => { setDemoStopId(id); setDemoRevision(value => value + 1); if (scenario === "initial") setScenario("estimated"); },
    locate: () => { setDemoStopId("tha-phra"); setDemoRevision(value => value + 1); setScenario("estimated"); },
    refreshRoute: () => setScenario("estimated"),
  }) : null;
  const { position, connection, error } = preview ?? livePosition;
  const pickup = preview?.pickup ?? livePickup;
  const quality = freshness(position, now || Date.now());
  const isLive = quality.kind === "live";
  const number = selectedId.slice(-1);
  const reconnect = useCallback(() => { if (demo) setScenario("estimated"); else setRefresh((value) => value + 1); }, [demo]);

  return <main className={"site" + (pickup.reloading ? " site-reloading" : "")}>
    <header className="header">
      <h1 className="header-title"><span className="header-name">รถชมพู</span>{" "}<span className="header-descriptor">ยูนิโอ จรัญฯ 3</span></h1>
    </header>

    {usb && <div className="demo-banner"><span><strong>ทดสอบผ่าน USB</strong> เชื่อมต่อเฉพาะรถคันที่ 1</span><a href="/">ดูระบบจริง</a></div>}
    {demo && <div className="demo-banner demo-controls"><label htmlFor="demo-scenario"><strong>ข้อมูลจำลอง</strong><select id="demo-scenario" value={scenario} onChange={event => { setScenario(demoScenarioSchema.parse(event.target.value)); setDemoRevision(value => value + 1); }}>{demoScenarioSchema.options.map(id => <option key={id} value={id}>{DEMO_SCENARIOS[id]}</option>)}</select></label><a href="/">ดูรถจริง</a><span>ข้อความและพิกัดจำลอง รถมาถึงจะค้างไว้ให้ดู</span></div>}

    <nav className="vehicle-tabs" aria-label="เลือกรถรับส่ง">
      {VEHICLES.map((item) => <button key={item.id} className={"vehicle-tab " + (selectedId === item.id ? "selected" : "")} disabled={!demo && item.id !== "SHUTTLE-01"} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
        <BusIcon size={20}/><span>{item.label}</span>
      </button>)}
    </nav>

    <section className={"pickup-panel" + (pickup.selected ? " pickup-panel-selected" : "") + (pickup.arrived ? " pickup-panel-arrived" : "")} aria-labelledby="pickup-heading">
      <div className="pickup-heading"><div className="pickup-intro"><h2 id="pickup-heading">ขึ้นรถกลับคอนโด</h2>{!pickup.selected && <p>เลือกจุดขึ้นรถเพื่อดูเวลาถึงโดยประมาณ</p>}</div><button className="locate-pickup" onClick={pickup.locate}>จุดขึ้นรถใกล้ฉัน</button></div>
      {pickup.selected ? <div className="pickup-eta" aria-busy={pickup.routeLoading}>
        <div className="eta-heading">
          <div className="eta-value" role="status">
            {pickup.arrived ? <span className="eta-number eta-arrived">รถมาถึงแล้ว</span> : pickup.routeLoading ? <span className="eta-skeleton eta-skeleton-number" aria-label="กำลังอัพเดตเวลาถึง" /> :
              pickup.estimate?.kind === "estimated" ? <span className="eta-number">{pickup.estimate.remainingMinutes <= 2 ? "รถใกล้จะถึงแล้ว" : `ประมาณ ${pickup.estimate.remainingMinutes} นาที`}</span> :
              <span>{!position ? "ยังไม่ได้เชื่อมต่อระบบพิกัด" : pickup.routeStatus || "ยังไม่มีเวลาถึงโดยประมาณ"}</span>}
          </div>
          {pickup.canRefreshRoute && <button className="refresh-route" aria-label="อัพเดตเส้นทาง" title="อัพเดตเส้นทาง" disabled={pickup.routeLoading} onClick={pickup.refreshRoute}>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M9 5.6A12 12 0 0 1 28 16h4l-7 12-7-12h6A8 8 0 0 0 11.3 9.1Z" /><path d="M9 5.6A12 12 0 0 1 28 16h4l-7 12-7-12h6A8 8 0 0 0 11.3 9.1Z" transform="rotate(180 16 16)" /></svg>
          </button>}
        </div>
        {pickup.arrived ? <span className="arrival-stop">ถึงจุดขึ้นรถ {pickup.selected.label} แล้ว</span> : pickup.routeLoading ? <span className="eta-skeleton eta-skeleton-distance" aria-hidden="true" /> :
          !pickup.arrived && pickup.estimate?.kind === "estimated" && <span>{pickup.estimate.distanceMeters === null ? "กดรีเฟรชเพื่อประเมินระยะทางใหม่" : <>ห่างออกไป {(pickup.estimate.distanceMeters / 1000).toFixed(1)} กม. จากจุดที่คุณเลือก</>}</span>}
        {pickup.arrived ? <small className="arrival-next">ดูตำแหน่งรถบนแผนที่และเตรียมขึ้นรถ</small> : pickup.routeLoading ? <span className="eta-skeleton eta-skeleton-description" aria-hidden="true" /> :
          pickup.estimate?.kind === "estimated" && <small>ระยะทางจาก GPS บนเส้นทางที่บันทึกไว้ เวลานับถอยหลังจากการอัพเดตล่าสุด</small>}
        {!pickup.arrived && !pickup.routeLoading && pickup.estimate?.kind === "estimated" && pickup.routeNotice && <small role="status">{pickup.routeNotice}</small>}
      </div> : null}
      {pickup.locationMessage && <p role="status">{pickup.locationMessage}</p>}
      <div className="pickup-options">{PICKUP_STOPS.map(stop => <button key={stop.id} aria-pressed={pickup.selected?.id === stop.id} onClick={() => pickup.select(stop.id)}>{stop.label}</button>)}</div>
    </section>

    <section className="tracker-layout" aria-label="ตำแหน่งรถที่เลือก">
      <VehicleMap key={selectedId} position={position} color={vehicle.color} number={number} stale={!isLive} selection={position ? pickup.selection : null} route={pickup.arrived ? null : pickup.route} arrived={pickup.arrived} preview={preview?.mapPreview ?? "normal"}/>
      {(connection === "unconfigured" || connection === "offline" || connection === "reconnecting" || error) &&
        <div className="connection-notice" role={error ? "alert" : "status"}>
          <span>{error || (connection === "unconfigured" ? "ยังไม่ได้เชื่อมต่อระบบพิกัด" : connection === "offline" ? "การเชื่อมต่อขาดหาย" : "กำลังเชื่อมต่อใหม่")}</span>
          {connection === "unconfigured" ? <a href="/?demo=1">ดูตัวอย่าง</a> : <button onClick={reconnect}>เชื่อมต่อใหม่</button>}
        </div>}
    </section>
  </main>;
}
