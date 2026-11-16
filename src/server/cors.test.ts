import { describe, expect, it, vi } from "vitest";
import { nativeCors } from "./cors";
const url = "https://bunblocks.app/api/save";
const handler = vi.fn(async () => new Response("ok", { headers: { "Cache-Control": "public, s-maxage=60" } }));
describe("native CORS", () => {
  it("allows exact native origins without cookies and disables shared caching", async () => {
    for (const origin of ["https://localhost", "capacitor://localhost"]) {
      const r = await nativeCors(new Request(url, { headers: { origin } }), handler);
      expect(r.headers.get("access-control-allow-origin")).toBe(origin);
      expect(r.headers.get("access-control-allow-credentials")).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("vary")).toContain("Origin");
    }
  });
  it("validates preflight headers and methods", async () => {
    for (const [method, headers, status] of [["POST", "content-type,x-player", 204], ["DELETE", "content-type", 403], ["POST", "authorization", 403]] as const) {
      const r = await nativeCors(new Request(url, { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": method, "access-control-request-headers": headers } }), handler);
      expect(r.status).toBe(status);
    }
  });
  it("rejects untrusted origins and native checkout before dispatch", async () => {
    const fn = vi.fn(handler);
    for (const origin of ["null", "http://localhost", "https://localhost.evil.test"]) expect((await nativeCors(new Request(url, { headers: { origin } }), fn)).status).toBe(403);
    expect((await nativeCors(new Request("https://bunblocks.app/api/checkout", { method: "POST", headers: { origin: "capacitor://localhost" } }), fn)).status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });
  it("preserves same-origin and webhook requests", async () => {
    for (const headers of [new Headers(), new Headers({ origin: "https://bunblocks.app" })]) expect(await (await nativeCors(new Request(url, { headers }), handler)).text()).toBe("ok");
  });
});
