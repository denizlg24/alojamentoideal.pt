/**
 * Resolves the public site origin for order emails. Bearer magic-links must point
 * at the environment that issued them, so this fails closed: a missing or
 * malformed origin throws (surfacing the misconfig) rather than silently emailing
 * a production link from a preview/staging deploy.
 */
function siteBaseUrl(): string {
	const configured =
		process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_AUTH_URL;
	if (!configured) {
		throw new Error(
			"Public site URL is not configured (set BETTER_AUTH_URL); refusing to email a fallback magic-link.",
		);
	}

	try {
		return new URL(configured).origin;
	} catch {
		throw new Error(`Public site URL is invalid: ${configured}`);
	}
}

/**
 * Builds the durable order-hub magic-link. The raw access token rides as a query
 * param to be redeemed into a scoped, httpOnly cookie on first visit; the booking
 * is never reachable by its low-entropy `reference` alone.
 */
export function orderHubUrl(reference: string, token: string): string {
	const url = new URL(`/order/${encodeURIComponent(reference)}`, siteBaseUrl());
	url.searchParams.set("token", token);
	return url.toString();
}
