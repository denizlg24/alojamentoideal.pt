// Vercel-served entry. The real app lives in `main.ts`; this file is what
// Vercel's zero-config Bun runtime serves. On deploy, `vercel.json`'s
// buildCommand bundles `main.ts` over this file so the function ships as a
// single self-contained module (Better Auth's import graph must not be left
// for Vercel's tracer to link). Local dev and tests import this re-export.
export { type ApiApp, default } from "./main.js";
