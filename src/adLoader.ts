// Loads Google's ad script, only if a publisher id was configured at build time. Until then (and if
// the script is blocked or fails) `adsReady()` stays false and the game offers no ad controls at all.

export const adsState = { requested: false, ready: false, blocked: false };

export const isPublisherId = (s: unknown): s is string => typeof s === "string" && /^ca-pub-\d{10,20}$/.test(s);

export const adsReady = (): boolean => adsState.ready && !adsState.blocked;

export function loadAds(clientId: string | undefined, test: boolean): void {
  if (adsState.requested || !isPublisherId(clientId)) return;
  adsState.requested = true;
  const w = window as unknown as { adsbygoogle?: unknown[]; adBreak?: unknown; adConfig?: unknown };
  // Google's documented shim: calls are queued until its script arrives.
  w.adsbygoogle = w.adsbygoogle ?? [];
  const queue = w.adsbygoogle;
  w.adBreak = w.adConfig = (o: unknown): void => { queue.push(o); };
  // The page may already carry Google's tag (AdSense site verification asks for it). Reuse it, never load twice.
  const existing = document.querySelector<HTMLScriptElement>('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
  if (existing) {
    const ready = (): void => { adsState.ready = true; (w.adConfig as (o: unknown) => void)({ preloadAdBreaks: "on", sound: "on" }); };
    if ((w.adsbygoogle as unknown as { loaded?: boolean }).loaded) ready(); else existing.addEventListener("load", ready);
    existing.addEventListener("error", () => { adsState.blocked = true; });
    return;
  }
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
  s.crossOrigin = "anonymous";
  if (test) s.setAttribute("data-adbreak-test", "on"); // Google's test mode: no real ads, no real billing
  s.onload = () => {
    adsState.ready = true;
    (w.adConfig as (o: unknown) => void)({ preloadAdBreaks: "on", sound: "on" });
  };
  s.onerror = () => { adsState.blocked = true; }; // an ad blocker: carry on with no ads
  document.head.append(s);
}
