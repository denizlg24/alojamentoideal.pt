import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { withApiRoute } from "@/lib/api/route";
import { getListingBookingAvailability } from "@/lib/catalog/availability";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

/**
 * The synced booking calendar (bookable nights + per-date min stay + soonest
 * stay) for a single listing. Served to the client so the listing page can
 * prerender statically while the frequently-changing calendar stays fresh per
 * request. Distinct from `/availability`, which is a live per-stay Hostify check.
 */
export const GET = withApiRoute(
	{ name: "accommodations.calendar", rateLimit: { bucket: "default" } },
	async (request: Request): Promise<Response> => {
		const searchParams = new URL(request.url).searchParams;
		const listingId = searchParams.get("listingId");
		if (!listingId) {
			return Response.json({ error: "listingId is required" }, { status: 400 });
		}
		const parsedMinNights = Number.parseInt(
			searchParams.get("minNights") ?? "",
			10,
		);
		const minNights =
			Number.isFinite(parsedMinNights) && parsedMinNights > 0
				? parsedMinNights
				: 1;

		const config = getListingCacheConfig();
		const availability = await getListingBookingAvailability(
			listingId,
			{
				accountId: config.hostifyAccountId,
				provider: HOSTIFY_PROVIDER,
			},
			minNights,
		);

		return Response.json({ data: availability });
	},
);
