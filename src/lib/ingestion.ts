import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { IncomingPosition, VehicleId } from "./domain";

const tokenSchema = z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/);
const configSchema = z.object({
  "SHUTTLE-01": tokenSchema,
  "SHUTTLE-02": tokenSchema,
  "SHUTTLE-03": tokenSchema,
}).refine((value) => new Set(Object.values(value)).size === 3, "Vehicle tokens must differ");
export function parseDriverTokens(raw: string | undefined) {
  if (!raw) return null;
  try { return configSchema.parse(JSON.parse(raw)); } catch { return null; }
}
export type DriverTokens = NonNullable<ReturnType<typeof parseDriverTokens>>;
export function authorizeDriver(header: string | null, vehicleId: VehicleId, tokens: DriverTokens): boolean {
  if (!header || !header.startsWith("Bearer ") || header.length > 300) return false;
  const actual = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(tokens[vehicleId]).digest();
  return timingSafeEqual(actual, expected);
}
export function captureRejection(position: IncomingPosition, nowMs = Date.now()): string | null {
  if (position.mock) return "mock_position";
  if (nowMs - position.capturedAtMs > 15_000) return "stale_position";
  if (position.capturedAtMs - nowMs > 5_000) return "future_position";
  return null;
}
export async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new Error("body_too_large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(bytes);
  let cursor = 0;
  for (const chunk of chunks) { combined.set(chunk, cursor); cursor += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined));
}
