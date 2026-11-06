import { z } from "zod";
import { positionSchema, vehicleIdSchema, freshness } from "../../../lib/domain";
import { boundedJson } from "../../../lib/ingestion";
import { PICKUP_STOPS, pickupStopIdSchema, routeResponseSchema, type RoadRoute } from "../../../lib/pickups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({ vehicleId: vehicleIdSchema, stopId: pickupStopIdSchema }).strict();
const pointSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
const providerSchema = z.object({ routes: z.array(z.object({
  summary: z.object({ lengthInMeters: z.number().finite().nonnegative(), travelTimeInSeconds: z.number().finite().nonnegative() }),
  legs: z.array(z.object({ points: z.array(pointSchema).min(2).max(20000) })).min(1).max(4),
})).min(1).max(1) });
type Result = { status: number; body: RoadRoute | { error: string } };
const cache = new Map<string, { expires: number; result: Result }>();
const pending = new Map<string, Promise<Result>>();
function reply(result: Result) {
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
function failure(error: string, status = 503): Result { return { status, body: { error } }; }
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error("response_too_large"); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await boundedJson(request); } catch { return reply(failure("invalid_request", 400)); }
  const input = requestSchema.safeParse(raw);
  if (!input.success) return reply(failure("invalid_request", 400));
  const key = process.env.TOMTOM_API_KEY;
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const storageKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return reply(failure("routing_not_configured"));
  if (!storageUrl || !storageKey) return reply(failure("storage_unavailable"));
  const { vehicleId, stopId } = input.data;
  const stop = PICKUP_STOPS.find((item) => item.id === stopId);
  if (!stop) return reply(failure("invalid_request", 400));
  try {
    const snapshot = await fetch(`${storageUrl.replace(/\/$/, "")}/rest/v1/vehicle_positions?vehicle_id=eq.${vehicleId}&select=*&limit=1`, {
      headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` }, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!snapshot.ok) return reply(failure("storage_unavailable"));
    const parsed = z.array(positionSchema).max(1).safeParse(await readJson(snapshot));
    if (!parsed.success) return reply(failure("storage_unavailable"));
    const position = parsed.data[0];
    if (!position || position.vehicle_id !== vehicleId || freshness(position).kind !== "live") return reply(failure("vehicle_unavailable", 409));
    if (position.accuracy_meters === null || position.accuracy_meters > 50) return reply(failure("vehicle_position_inaccurate", 422));
    if (position.latitude < 13.65 || position.latitude > 13.80 || position.longitude < 100.40 || position.longitude > 100.55) return reply(failure("vehicle_outside_service_area", 422));
    const cacheKey = `${vehicleId}:${stopId}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return reply(cached.result);
    const existing = pending.get(cacheKey);
    if (existing) return reply(await existing);
    const calculate = async (): Promise<Result> => {
      try {
        const endpoint = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${position.latitude},${position.longitude}:${stop.latitude},${stop.longitude}/json`);
        endpoint.search = new URLSearchParams({ key, traffic: "true", departAt: "now", travelMode: "car", routeType: "fastest", maxAlternatives: "0", routeRepresentation: "polyline" }).toString();
        if (position.bearing_degrees !== null && (position.speed_meters_per_second ?? 0) > 1) endpoint.searchParams.set("vehicleHeading", String(Math.round(position.bearing_degrees) % 360));
        const upstream = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8000), redirect: "error" });
        if (!upstream.ok) return failure("routing_unavailable");
        const data = providerSchema.safeParse(await readJson(upstream));
        if (!data.success) return failure("route_not_found", 404);
        const route = data.data.routes[0];
        if (!route) return failure("route_not_found", 404);
        const body = routeResponseSchema.safeParse({
          points: route.legs.flatMap((leg) => leg.points.map((point) => [point.latitude, point.longitude])),
          durationSeconds: route.summary.travelTimeInSeconds, distanceMeters: route.summary.lengthInMeters,
          fetchedAt: new Date().toISOString(), vehicleId, stopId, sourceRevision: position.revision, trafficAware: true, provider: "tomtom",
        });
        return body.success ? { status: 200, body: body.data } : failure("routing_unavailable");
      } catch { return failure("routing_unavailable"); }
    };
    const job = calculate().then((result) => {
      cache.set(cacheKey, { expires: Date.now() + 30000, result });
      return result;
    }).finally(() => pending.delete(cacheKey));
    pending.set(cacheKey, job);
    return reply(await job);
  } catch { return reply(failure("storage_unavailable")); }
}
