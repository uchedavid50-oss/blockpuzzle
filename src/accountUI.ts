// The sign-in sheet. Unlike the rest of the game's screens it is HTML, not canvas: typing an email and a
// code needs real inputs (the phone's keyboard, autofill of one-time codes), and Google's button must be
// rendered by Google's own script. Styled to match the candy sheets drawn in gfx.ts.

import { BRAND, COLORS, ROUND } from "./gfx.js";
import { account, sendEmailCode, signInWithGoogle, signOut, signedIn, signinOffered, verifyEmailCode, type SigninResult } from "./cloudClient.js";
import { lb } from "./leaderboardClient.js";

/** Why the sheet was opened, which sets its opening line. */
export type Why = "settings" | "purchase" | "journey" | "lost";
const INTRO: Record<Why, string> = {
  settings: "Sign in so your progress, coins and purchases are safe if you lose or change your phone.",
  purchase: "Sign in first so this purchase is never lost, even if you lose your phone.",
  journey: "Nice progress! Sign in so you never lose it, even on a new phone.",
  lost: "This account is now on another device. Sign in again to keep playing with it here.",
};

const CSS = `
.bp-acct{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;font-family:${ROUND};color:${COLORS.text}}
.bp-acct::backdrop{background:rgba(40,10,70,.45)}
.bp-acct .sheet{box-sizing:border-box;width:min(360px,calc(100% - 32px));margin:max(40px,12vh) auto 0;background:#fff;border-radius:24px;padding:22px 20px 18px;box-shadow:0 10px 40px rgba(60,20,120,.35);text-align:center}
.bp-acct h2{margin:0 0 6px;font-size:22px;color:${BRAND.deep}}
.bp-acct p{margin:0 0 14px;font-size:14px;line-height:1.4;color:${COLORS.dim}}
.bp-acct input{box-sizing:border-box;width:100%;font:inherit;font-size:17px;padding:12px 14px;border-radius:14px;border:2px solid #d9cbea;margin-bottom:10px;color:${COLORS.text};background:#fff}
.bp-acct input:focus{outline:none;border-color:${BRAND.violet}}
.bp-acct input.code{letter-spacing:8px;text-align:center;font-size:22px}
.bp-acct button{font:inherit;font-size:16px;font-weight:800;border:0;border-radius:16px;padding:12px 16px;width:100%;cursor:pointer;margin-bottom:8px}
.bp-acct .go{background:linear-gradient(#b38aff,${BRAND.deep});color:#fff;box-shadow:0 3px 0 #3d1590}
.bp-acct .go:disabled{opacity:.6}
.bp-acct .plain{background:transparent;color:${BRAND.violet};font-size:14px;padding:8px}
.bp-acct .or{display:flex;align-items:center;gap:10px;margin:6px 0 12px;font-size:12px;color:${COLORS.dim}}
.bp-acct .or::before,.bp-acct .or::after{content:"";flex:1;height:1px;background:#e5daf2}
.bp-acct .msg{min-height:18px;font-size:13px;color:#c0264a;margin:0 0 8px}
.bp-acct .ok{color:#178a5a}
.bp-acct .google{display:flex;justify-content:center;min-height:44px;margin-bottom:4px}
.bp-acct .fine{font-size:11.5px;margin:8px 0 0}
`;

let dialog: HTMLDialogElement | null = null;
let googleReady: Promise<boolean> | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

/** Loads Google's sign-in script once. False if it cannot be loaded (offline, blocked). */
function loadGoogle(): Promise<boolean> {
  googleReady ??= new Promise((resolve) => {
    const s = el("script", { src: "https://accounts.google.com/gsi/client", async: true });
    s.onload = () => resolve(true);
    s.onerror = () => { googleReady = null; resolve(false); };
    document.head.append(s);
  });
  return googleReady;
}

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: string }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
}
const gsi = (): GoogleId | undefined => (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id;

function close(): void {
  dialog?.close();
  dialog?.remove();
  dialog = null;
}

/** Signing in or out swaps every saved value, so the game starts again cleanly with the new ones. */
const restart = (): void => { setTimeout(() => location.reload(), 900); };

/**
 * Opens the sign-in sheet (or, when signed in, the account sheet). `onDone` runs when it closes
 * without a restart, e.g. to carry on to checkout after "Not now".
 */
export function openAccount(why: Why = "settings", onDone?: () => void): void {
  if (dialog || !signinOffered()) { onDone?.(); return; }
  if (!document.getElementById("bp-acct-css")) document.head.append(el("style", { id: "bp-acct-css", textContent: CSS }));
  dialog = el("dialog", { className: "bp-acct" });
  const sheet = el("div", { className: "sheet" });
  dialog.append(sheet);
  dialog.addEventListener("cancel", () => { close(); onDone?.(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) { close(); onDone?.(); } });
  document.body.append(dialog);
  if (signedIn()) accountView(sheet, onDone); else signInView(sheet, why, onDone);
  dialog.showModal();
}

function accountView(sheet: HTMLElement, onDone?: () => void): void {
  const a = account()!;
  const msg = el("p", { className: "msg" });
  const out = el("button", { className: "go", textContent: "Sign out" });
  out.onclick = async () => {
    if (!confirm("Sign out? Your progress stays in your account. This device will start fresh until you sign in again.")) return;
    out.disabled = true; msg.textContent = "Saving your progress…"; msg.className = "msg ok";
    const r = await signOut();
    if (r.ok) { msg.textContent = "Signed out."; restart(); } else { out.disabled = false; msg.className = "msg"; msg.textContent = r.message; }
  };
  const methods = Object.entries(a.methods).map(([m, l]) => `${m === "google" ? "Google" : "Email"}: ${l}`).join(" · ");
  const done = el("button", { className: "plain", textContent: "Done" });
  done.onclick = () => { close(); onDone?.(); };
  sheet.append(
    el("h2", { textContent: "Your account" }),
    el("p", { textContent: `Signed in as ${a.label}. Your progress is saved automatically.` }),
    ...(methods ? [el("p", { className: "fine", textContent: methods })] : []),
    msg, out, done);
}

function signInView(sheet: HTMLElement, why: Why, onDone?: () => void): void {
  const msg = el("p", { className: "msg" });
  const show = (r: SigninResult, okText: string): void => {
    msg.className = r.ok ? "msg ok" : "msg";
    msg.textContent = r.ok ? okText : r.message;
  };
  const later = el("button", { className: "plain", textContent: why === "purchase" ? "Continue without signing in" : "Not now" });
  later.onclick = () => { close(); onDone?.(); };

  const parts: Node[] = [el("h2", { textContent: why === "lost" ? "Sign in again" : "Save your progress" }), el("p", { textContent: INTRO[why] })];

  if (lb.signin.google) {
    const box = el("div", { className: "google" });
    parts.push(box);
    void loadGoogle().then((ok) => {
      const g = gsi();
      if (!ok || !g) { box.textContent = "Google sign-in could not load."; return; }
      g.initialize({
        client_id: lb.signin.google!,
        callback: (resp) => {
          if (!resp.credential) return;
          msg.className = "msg ok"; msg.textContent = "Signing in…";
          void signInWithGoogle(resp.credential).then((r) => { show(r, "Signed in. Loading your progress…"); if (r.ok) restart(); });
        },
      });
      g.renderButton(box, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: Math.min(300, sheet.clientWidth - 40) });
    });
  }

  if (lb.signin.email) {
    if (lb.signin.google) parts.push(el("div", { className: "or", textContent: "or use your email" }));
    const email = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", inputMode: "email", required: true });
    const code = el("input", { className: "code", placeholder: "••••••", autocomplete: "one-time-code", inputMode: "numeric", maxLength: 6 });
    code.hidden = true;
    const go = el("button", { className: "go", textContent: "Email me a code" });
    const other = el("button", { className: "plain", textContent: "Use a different email" });
    other.hidden = true;
    let sent = false;
    const step = async (): Promise<void> => {
      if (go.disabled) return; // Enter and a pasted code can both ask at once
      go.disabled = true;
      if (!sent) {
        msg.className = "msg ok"; msg.textContent = "Sending…";
        const r = await sendEmailCode(email.value);
        show(r, `We sent a 6-digit code to ${email.value.trim()}. It works for 10 minutes.`);
        if (r.ok) { sent = true; email.readOnly = true; code.hidden = false; other.hidden = false; go.textContent = "Sign in"; code.focus(); }
      } else {
        msg.className = "msg ok"; msg.textContent = "Checking…";
        const r = await verifyEmailCode(email.value, code.value);
        show(r, "Signed in. Loading your progress…");
        if (r.ok) { restart(); return; }
      }
      go.disabled = false;
    };
    go.onclick = () => { void step(); };
    for (const i of [email, code]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void step(); } });
    code.addEventListener("input", () => { if (/^\d{6}$/.test(code.value)) void step(); });
    other.onclick = () => { sent = false; email.readOnly = false; code.hidden = true; code.value = ""; other.hidden = true; go.textContent = "Email me a code"; msg.textContent = ""; email.focus(); };
    parts.push(email, code, msg, go, other);
  } else {
    parts.push(msg);
  }
  parts.push(later, el("p", { className: "fine", textContent: "Optional. We keep only what is needed to find your account again. See the privacy page." }));
  sheet.append(...parts);
}
