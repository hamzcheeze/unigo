export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" || process.env.GOGO_USB_PREVIEW !== "1"
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return new Response(null, { status: 404 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });
  try {
    const response = await fetch("http://127.0.0.1:8787/events", { cache: "no-store", signal: request.signal });
    if (!response.ok || !response.body) throw new Error("bridge_unavailable");
    return new Response(response.body, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    } });
  } catch {
    return Response.json({ error: "usb_bridge_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
