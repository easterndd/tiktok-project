/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENTRY_REWARDED_AD_UNIT_IDS?: string;
  readonly VITE_ENTRY_COMPAT_MODE?: string;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
