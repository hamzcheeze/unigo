import { isFreshLocation } from "./geofence";

export type ResidentLocation = { kind: "located"; latitude: number; longitude: number; accuracy: number; timestamp: number };
type LocationResult = ResidentLocation | { kind: "denied" | "unavailable" | "cancelled" };

export async function requestResidentLocation({ geolocation, signal }: {
  geolocation: Pick<Geolocation, "getCurrentPosition">;
  signal: AbortSignal;
}): Promise<LocationResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) return { kind: "cancelled" };
    const result = await new Promise<LocationResult>(resolve => {
      let settled = false;
      const finish = (value: LocationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish({ kind: "cancelled" });
      const timer = setTimeout(() => finish({ kind: "unavailable" }), 3000);
      signal.addEventListener("abort", cancel, { once: true });
      try {
        geolocation.getCurrentPosition(value => {
          const { latitude, longitude, accuracy } = value.coords;
          if (![latitude, longitude, accuracy, value.timestamp].every(Number.isFinite) || accuracy < 0 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !isFreshLocation(value.timestamp, Date.now())) {
            finish({ kind: "unavailable" });
            return;
          }
          finish({ kind: "located", latitude, longitude, accuracy, timestamp: value.timestamp });
        }, error => finish({ kind: error.code === 1 ? "denied" : "unavailable" }), {
          enableHighAccuracy: true, maximumAge: 0, timeout: 3000,
        });
      } catch { finish({ kind: "unavailable" }); }
    });
    if (result.kind !== "unavailable") return result;
  }
  return { kind: "unavailable" };
}
