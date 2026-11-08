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
  private readonly pending = new Map<string, { promise: Promise<void>; controller: AbortController }>();

  private readonly retryControllers = new Set<AbortController>();

  constructor(
    private readonly loader: (pair: RoutePair, signal: AbortSignal) => Promise<RoadRoute>,
    private readonly waitToRetry: (signal: AbortSignal) => Promise<void> = waitForRetry,
    private readonly clock: () => number = Date.now,
  ) {}

  cancelRetries() {
    for (const controller of this.retryControllers) controller.abort();
  }

  invalidateVehicle(vehicleId: VehicleId) {
    const prefix = vehicleId + ":";
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
    for (const [key, request] of this.pending) {
      if (!key.startsWith(prefix)) continue;
      this.pending.delete(key);
      this.retryControllers.delete(request.controller);
      request.controller.abort();
    }
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
    if (existing) return existing.promise;
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
        try {
          const route = await this.loader(pair, controller.signal);
          if (controller.signal.aborted) throw new Error("หยุดการอัพเดตเส้นทางแล้ว");
          return route;
        }
        catch (error) {
          if (controller.signal.aborted) throw new Error("หยุดการอัพเดตเส้นทางแล้ว");
          if (!(error instanceof RouteUnavailableError) || retries >= 3) throw error;
          retries++;
          await this.waitToRetry(controller.signal);
        }
      }
    };
    const request = Promise.resolve().then(load).then((route) => {
      if (this.pending.get(key)?.controller !== controller) return;
      if (route.vehicleId !== pair.vehicleId || route.stopId !== pair.stopId) {
        throw new Error("ข้อมูลเส้นทางไม่ตรงกับรถหรือจุดขึ้นรถที่เลือก");
      }
      this.entries.set(key, { kind: "ready", snapshot: { route, receivedAt: this.clock() } });
    }).catch((error: unknown) => {
      if (this.pending.get(key)?.controller !== controller) return;
      this.entries.set(key, { kind: "error", previousSnapshot, message: error instanceof Error ? error.message : "โหลดเส้นทางไม่ได้ กรุณาลองใหม่" });
    }).finally(() => {
      if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
      this.retryControllers.delete(controller);
    });
    this.pending.set(key, { promise: request, controller });
    return request;
  }

  retry(pair: RoutePair): Promise<void> {
    const existing = this.pending.get(this.key(pair));
    if (existing) return existing.promise;
    const previous = this.get(pair);
    const previousSnapshot = previous?.kind === "ready" ? previous.snapshot : previous?.previousSnapshot ?? null;
    return this.request(pair, previousSnapshot);
  }
}
