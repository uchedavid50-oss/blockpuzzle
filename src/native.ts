import { isNative } from "./platform";

export async function startNativeLifecycle(save: () => void): Promise<void> {
  if (!isNative()) return;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) save();
      else document.dispatchEvent(new Event("visibilitychange"));
    });
    // Keep Android back from destroying the activity and its active run.
    await App.addListener("backButton", () => { save(); void App.minimizeApp(); });
  } catch (error) { console.error("Native lifecycle unavailable", error); }
}

export async function shareNative(text: string, url: string): Promise<void> {
  const { Share } = await import("@capacitor/share");
  await Share.share({ text, url, dialogTitle: "Share Bunblocks" });
}
