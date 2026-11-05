import { z } from "zod";
import { incomingPositionSchema } from "../../../lib/domain";
import { authorizeDriver, boundedJson, captureRejection, parseDriverTokens } from "../../../lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const resultSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true), revision: z.number().int().positive() }),
  z.object({ accepted: z.literal(false), reason: z.string() }),
]);
function reply(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const tokens = parseDriverTokens(process.env.DRIVER_TOKENS_JSON);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!tokens || !url || !key) return reply({ error: "server_not_configured" }, 503);
  let raw: unknown;
  try { raw = await boundedJson(request); }
  catch (error) { return reply({ error: error instanceof Error && error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, error instanceof Error && error.message === "body_too_large" ? 413 : 400); }
  const parsed = incomingPositionSchema.safeParse(raw);
  if (!parsed.success) return reply({ error: "invalid_position" }, 400);
  const position = parsed.data;
  if (!authorizeDriver(request.headers.get("authorization"), position.vehicleId, tokens)) return reply({ error: "unauthorized" }, 401);
  const rejection = captureRejection(position);
  if (rejection) return reply({ error: rejection }, 422);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/ingest_position`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_position: position }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return reply({ error: "storage_unavailable" }, 503);
    const result = resultSchema.safeParse(await response.json());
    if (!result.success) return reply({ error: "storage_unavailable" }, 503);
    if (!result.data.accepted) return reply({ error: result.data.reason }, 409);
    return reply({ accepted: true, revision: result.data.revision }, 200);
  } catch { return reply({ error: "storage_unavailable" }, 503); }
}
