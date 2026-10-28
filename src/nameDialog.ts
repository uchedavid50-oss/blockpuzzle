// A small modal that asks for a public nickname. It is real HTML (not canvas) so the on-screen
// keyboard, autofill and screen readers all work. Resolves with the nickname, or null if cancelled.

const NAME_RE = /^[\p{L}\p{N} ._-]{3,16}$/u;

export function askName(initial: string | null, errorText = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,9,14,0.78)";
    const card = document.createElement("form");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Choose a leaderboard name");
    card.style.cssText =
      "width:100%;max-width:340px;box-sizing:border-box;padding:22px;border-radius:22px;background:#1b2034;color:#eef1f8;" +
      "border:1px solid rgba(255,255,255,0.1);box-shadow:0 20px 60px rgba(0,0,0,0.6);font:500 14px system-ui,-apple-system,sans-serif";
    card.innerHTML =
      '<div style="font:800 20px system-ui,sans-serif;margin-bottom:6px">Join the leaderboard</div>' +
      '<p style="margin:0 0 14px;color:#9aa3b8;line-height:1.4">Pick a nickname. Your nickname and score will be public. ' +
      "No account or personal details are collected.</p>";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.value = initial ?? "";
    input.placeholder = "Nickname (3 to 16 characters)";
    input.setAttribute("autocomplete", "nickname");
    input.setAttribute("aria-label", "Nickname");
    input.style.cssText = "width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:#11152a;color:#fff;font:600 16px system-ui,sans-serif";
    const err = document.createElement("div");
    err.style.cssText = "min-height:18px;margin:8px 0 12px;color:#ff8a8a;font-size:13px";
    err.textContent = errorText;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
    const btn = (text: string, primary: boolean, type: "button" | "submit"): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = type;
      b.textContent = text;
      b.style.cssText =
        "border:0;border-radius:999px;padding:10px 18px;font:700 14px system-ui,sans-serif;cursor:pointer;" +
        (primary ? "background:#4da3ff;color:#fff" : "background:transparent;color:#9aa3b8");
      return b;
    };
    const cancel = btn("Cancel", false, "button");
    const ok = btn("Post score", true, "submit");
    row.append(cancel, ok);
    card.append(input, err, row);
    backdrop.append(card);

    const finish = (value: string | null): void => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") finish(null); };
    document.addEventListener("keydown", onKey);
    cancel.onclick = () => finish(null);
    // The tap that opened this dialog can arrive as a click on the new backdrop; ignore the first moments.
    const openedAt = performance.now();
    backdrop.onclick = (e) => { if (e.target === backdrop && performance.now() - openedAt > 500) finish(null); };
    card.onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.replace(/\s+/g, " ").trim();
      if (!NAME_RE.test(name)) { err.textContent = "Use 3 to 16 letters, numbers or spaces."; return; }
      finish(name);
    };
    document.body.append(backdrop);
    input.focus();
    input.select();
  });
}
