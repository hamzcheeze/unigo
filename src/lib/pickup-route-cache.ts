import type { VehicleId } from "./domain";
import type { PickupStopId, RoadRoute } from "./pickups";

export type RoutePair = { vehicleId: VehicleId; stopId: PickupStopId };
export type RouteSnapshot = { route: RoadRoute; receivedAt: number };
export type PickupRouteEntry =
  | { kind: "loading"; previousSnapshot: RouteSnapshot | null }
  | { kind: "ready"; snapshot: RouteSnapshot }
  | { kind: "error"; previousSnapshot: RouteSnapshot | null; message: string };

export class RouteUnavailableError extends Error {
  constructor() { super("ยังไม่พร้อมแสดงเส้นทางและเวลาถึง"); }
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new Error("หยุดการอัพเดตเส้นทางแล้ว")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 30000);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

export class PickupRouteCache {
  private readonly entries = new Map<string, PickupRouteEntry>();
  private readonly pending = new Map<string, Promise<void>>();

  private readonly retryControllers = new Set<AbortController>();

  constructor(
    private readonly loader: (pair: RoutePair) => Promise<RoadRoute>,
    private readonly waitToRetry: (signal: AbortSignal) => Promise<void> = waitForRetry,
    private readonly clock: () => number = Date.now,
  ) {}

  cancelRetries() {
    for (const controller of this.retryControllers) controller.abort();
  }

  private key(pair: RoutePair) {
    return pair.vehicleId + ":" + pair.stopId;
  }

  get(pair: RoutePair): PickupRouteEntry | undefined {
    return this.entries.get(this.key(pair));
  }

  load(pair: RoutePair): Promise<void> {
    const key = this.key(pair);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.entries.has(key)) return Promise.resolve();
    return this.request(pair, null);
  }

  private request(pair: RoutePair, previousSnapshot: RouteSnapshot | null): Promise<void> {
    const key = this.key(pair);
    this.entries.set(key, { kind: "loading", previousSnapshot });
    const controller = new AbortController();
    this.retryControllers.add(controller);
    const load = async () => {
      let retries = 0;
      while (true) {
        if (controller.signal.aborted) throw new Error("หยุดการอัพเดตเส้นทางแล้ว");
        try { return await this.loader(pair); }
        catch (error) {
          if (!(error instanceof RouteUnavailableError) || retries >= 3) throw error;
          retries++;
          await this.waitToRetry(controller.signal);
        }
      }
    };
    const request = Promise.resolve().then(load).then((route) => {
      if (route.vehicleId !== pair.vehicleId || route.stopId !== pair.stopId) {
        throw new Error("ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก");
      }
      this.entries.set(key, { kind: "ready", snapshot: { route, receivedAt: this.clock() } });
    }).catch((error: unknown) => {
      this.entries.set(key, { kind: "error", previousSnapshot, message: error instanceof Error ? error.message : "โหลดเส้นทางไม่ได้ กรุณาลองใหม่" });
    }).finally(() => {
      this.pending.delete(key);
      this.retryControllers.delete(controller);
    });
    this.pending.set(key, request);
    return request;
  }

  retry(pair: RoutePair): Promise<void> {
    const existing = this.pending.get(this.key(pair));
    if (existing) return existing;
    const previous = this.get(pair);
    const previousSnapshot = previous?.kind === "ready" ? previous.snapshot : previous?.previousSnapshot ?? null;
    return this.request(pair, previousSnapshot);
  }
}
