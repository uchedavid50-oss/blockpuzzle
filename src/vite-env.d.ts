/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HTTPS origin for an isolated native billing test deployment. */
  readonly VITE_NATIVE_API_ORIGIN?: string;
  /** Where anonymous analytics events are sent. Unset means analytics are off. */
  readonly VITE_ANALYTICS_ENDPOINT?: string;
  /** Public native iOS OAuth client; must match the compiled callback URL scheme. */
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
}
