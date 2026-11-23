/// <reference types="astro/client" />

declare const __ASTRO_DEV_SERVER__: boolean;

interface ImportMetaEnv {
  readonly PUBLIC_FONT_PREVIEW?: string;
}

declare namespace App {
  interface Locals {
    auth: import("./domain/authorization/context").AuthContext | null;
  }
}
