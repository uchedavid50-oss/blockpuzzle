/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where anonymous analytics events are sent. Unset means analytics are off. */
  readonly VITE_ANALYTICS_ENDPOINT?: string;
}
