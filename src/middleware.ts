// src/middleware.ts
// TODO: Phase C (Auth/security) - Supabase SSR session & tenant auth middleware
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (_context, next) => {
  return next();
});
