import { type Auth, createAuth } from "./runtime.js";

export type { Auth };
export type Session = Auth["$Infer"]["Session"];
export type AuthUser = Session["user"];

let instance: Auth | undefined;

/**
 * Returns the memoized Better Auth instance, creating it on first use.
 * The import is static so Vercel bundles the Better Auth graph into the
 * function, while instantiation stays lazy so nothing runs at startup.
 */
export function getAuth(): Auth {
	instance ??= createAuth();

	return instance;
}
