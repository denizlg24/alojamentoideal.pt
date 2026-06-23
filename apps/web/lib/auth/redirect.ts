/**
 * Returns a safe same-origin redirect path. Blocks absolute URLs and
 * protocol-relative `//host` values so a crafted `next` param cannot redirect
 * the visitor off-site after login.
 */
export function safeNextPath(
	value: string | null | undefined,
	fallback = "/",
): string {
	if (!value?.startsWith("/") || value.startsWith("//")) {
		return fallback;
	}
	return value;
}

/**
 * Destination for an already-authenticated visitor who lands on an auth page.
 * Honours a pending `next` (e.g. a booking they were sent to sign in for) but
 * never loops back onto an auth route, falling back to the account page.
 */
export function signedInRedirectTarget(
	next: string | null | undefined,
): string {
	const safe = safeNextPath(next, "/account");
	if (
		safe === "/" ||
		safe.startsWith("/login") ||
		safe.startsWith("/register")
	) {
		return "/account";
	}
	return safe;
}
