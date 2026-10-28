// The shared web code reads Vite's build settings from import.meta.env.
// babel/vite-env.js supplies them in this app; this tells TypeScript.
// Same shape as Vite's own declaration.
interface ImportMetaEnv {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
