/** Exact WebView origins only. CORS is not authentication; existing verification remains required. */
const nativeOrigins = new Set(["https://localhost", "capacitor://localhost"]);
const allowedHeaders = new Set(["content-type", "x-player"]);
export async function nativeCors(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin;
  if (!origin || sameOrigin) {
    const response = await handler(request);
    const result = new Response(response.body, response);
    result.headers.append("Vary", "Origin");
    return result;
  }
  if (!nativeOrigins.has(origin)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } });
  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Player",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (request.method === "OPTIONS") {
    const method = request.headers.get("access-control-request-method");
    const requested = (request.headers.get("access-control-request-headers") ?? "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
    const valid = (method === "GET" || method === "POST") && requested.every(h => allowedHeaders.has(h));
    return new Response(null, { status: valid ? 204 : 403, headers });
  }
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (["/api/checkout", "/api/purchase"].includes(path)) return new Response(null, { status: 403, headers });
  const response = await handler(request);
  const result = new Response(response.body, response);
  headers.forEach((value, key) => {
    if (key === "vary") result.headers.append(key, value);
    else result.headers.set(key, value);
  });
  return result;
}
