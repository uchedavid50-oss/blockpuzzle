import { defineConfig } from "vite";

// In development and preview, /api is forwarded to the local dev server (npm run dev:api).
// In production Vercel serves the api/ routes directly.
const proxy = { "/api": "http://localhost:8787" };
export default defineConfig({ server: { proxy }, preview: { proxy } });
