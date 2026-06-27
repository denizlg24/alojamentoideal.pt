const SITE_URL_FALLBACK = "https://alojamentoideal.pt";

/** Resolves the public site origin from auth config, falling back to production. */
export function siteBaseUrl(): string {
	const configured =
		process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_AUTH_URL;
	if (!configured) {
		return SITE_URL_FALLBACK;
	}

	try {
		return new URL(configured).origin;
	} catch {
		return SITE_URL_FALLBACK;
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
