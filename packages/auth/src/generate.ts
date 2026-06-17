import { createAuth } from "./runtime.js";

/**
 * Dedicated entry for the Better Auth CLI (`better-auth generate`), which
 * expects an exported `auth` instance. App code must never import this module:
 * it instantiates Better Auth at module load. The runtime path stays lazy via
 * `getAuth()` so nothing runs at startup or during Vercel's build trace.
 */
export const auth = createAuth();
