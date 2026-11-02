import type { VideoSpec } from "./types";

// Areas of the 1280x800 capture of public/admin.html (see scripts/capture-admin.ts). Named areas
// ({ ref }) are measured by the capture itself.

/** Demo ids are blurred anyway: the search text, the "account now lives on" note, references and players. */
const PRIVATE = [{ x: 152, y: 122, w: 560, h: 36 }, { x: 286, y: 164, w: 210, h: 24 }, { x: 296, y: 305, w: 446, h: 495 }];
export const admin: VideoSpec = {
  id: "admin",
  title: "The Block Puzzle admin dashboard",
  orientation: "landscape",
  viewport: { w: 1280, h: 800 },
  beats: [
    { id: "hook", clip: "overview", from: 0, caption: "Block Puzzle · Admin", say: "Every number about your game, on one page.", zoom: { x: 640, y: 260, s: 1.1, at: 0.4 } },
    { id: "open", clip: "login", from: 0, step: 1, caption: "Open /admin.html", say: "Open slash admin dot html on your site." },
    { id: "token", clip: "login", from: "continue", step: 2, caption: "Enter your admin token", chip: "Load", say: "Paste the admin token from your server settings, and press Load.",
      spot: [{ at: 0, ref: "token" }], blur: [{ ref: "token" }] },
    { id: "cards", clip: "login", from: "continue", caption: "Summary", say: "The cards show players today, yesterday, and totals for the last two weeks.",
      spot: [{ at: 0.2, ref: "cards-login" }], blur: [{ ref: "token" }] },
    { id: "days", clip: "tables", from: 0, caption: "Last 14 days", say: "Below, each day's players, sessions, and games.", spot: [{ at: 0.9, ref: "days" }] },
    { id: "retention", clip: "tables", from: "continue", caption: "Retention", say: "Retention shows how many players came back after one, seven, and thirty days.", spot: [{ at: 1.2, ref: "retention-cols" }] },
    { id: "sources", clip: "tables", from: "continue", caption: "Where players came from", say: "Add a source to your links, like question mark, src equals instagram, to see where players come from.", spot: [{ at: 0.9, ref: "sources" }] },
    { id: "money", clip: "tables", from: "continue", caption: "Ads, purchases and coins", say: "Then ads, purchases, and coins: what was earned, spent, and sold.", spot: [{ at: 0.9, ref: "money" }] },
    { id: "search", clip: "payments", from: 0, step: 3, caption: "Find a payment", chip: "Search", say: "To check a payment, search by its reference, or a player id.",
      spot: [{ at: 0, ref: "search" }], blur: PRIVATE },
    { id: "status", clip: "payments", from: "continue", caption: "Payment status", say: "Each payment shows its amount and status, including refunds and disputes.",
      spot: [{ at: 0, ref: "status-col" }, { at: 2.4, ref: "ptotals" }], blur: PRIVATE },
    { id: "private", clip: "overview", from: 0, caption: "Anonymous by design", say: "Everything here is anonymous. No emails, and no personal data.", zoom: { x: 640, y: 300, s: 1.06, at: 0.2 } },
    { id: "end", say: "Block Puzzle.", minSec: 4.5 },
  ],
  endCard: { title: "Block Puzzle", subtitle: "Admin dashboard" },
};
