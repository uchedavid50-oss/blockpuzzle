import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.bunblocks.game",
  appName: "Bunblocks",
  webDir: "dist-native",
  server: { hostname: "localhost", androidScheme: "https", iosScheme: "capacitor", cleartext: false },
  android: { allowMixedContent: false },
  plugins: {
    SystemBars: { insetsHandling: "native", initialViewportFitValueHint: "contain" },
    SocialLogin: { providers: { google: true, apple: false, facebook: false, twitter: false }, logLevel: 0 },
  },
};
export default config;
