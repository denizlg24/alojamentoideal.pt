import { timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { getListingCacheConfig } from "./config.js";

export function listingCacheRoutes() {
	return new Elysia({ name: "listing-cache-routes" }).post(
		"/cron/hostify/listings",
		async ({ request, status }) => {
			const config = getListingCacheConfig();

			if (!config.cronSecret) {
				return status(503, { error: "Cron secret is not configured" });
			}

			if (!isAuthorizedCronRequest(request, config.cronSecret)) {
				return status(401, { error: "Unauthorized" });
			}

			try {
				const { createHostifyListingCacheSyncFromEnv } = await import(
					"./hostify-sync.js"
				);
				const sync = createHostifyListingCacheSyncFromEnv();
				const result = await sync.syncListings("cron");

				return {
					data: result,
					success: true,
				};
			} catch (error) {
				console.error("Hostify listing sync failed", error);
				return status(500, { error: "Hostify listing sync failed" });
			}
		},
	);
}

export function isAuthorizedCronRequest(
	request: Request,
	expectedSecret: string,
): boolean {
	const authorization = request.headers.get("authorization");
	const bearerSecret = authorization?.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: undefined;
	const providedSecret = bearerSecret ?? request.headers.get("x-cron-secret");

	if (!providedSecret) {
		return false;
	}

	return safeEqual(providedSecret, expectedSecret);
}

function safeEqual(value: string, expected: string): boolean {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);

	return (
		valueBuffer.length === expectedBuffer.length &&
		timingSafeEqual(valueBuffer, expectedBuffer)
	);
}
