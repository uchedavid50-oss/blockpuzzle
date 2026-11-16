import { defineConfig } from "vite";

// In development and preview, /api is forwarded to the local dev server (npm run dev:api).
// In production Vercel serves the api/ routes directly.
// The forwarded host lets the local API build return URLs that point back at this page.
const proxy = {
  "/api": {
    target: "http://localhost:8787",
    configure: (p: { on: (e: string, f: (r: { setHeader: (k: string, v: string) => void }, q: { headers: { host?: string } }) => void) => void }) =>
      p.on("proxyReq", (r, q) => r.setHeader("x-forwarded-host", q.headers.host ?? "localhost")),
  },
};
export default defineConfig(({ mode }) => ({
  server: { proxy }, preview: { proxy },
  build: { outDir: mode === "native" ? "dist-native" : "dist" },
  plugins: [{
    name: "native-html",
    transformIndexHtml(html) {
      if (mode !== "native") return html;
      return html.replace(/<script async src="https:\/\/pagead2[^>]*><\/script>/g, "")
        .replace(/<link rel="manifest"[^>]*>/g, "");
    },
  }],
}));
