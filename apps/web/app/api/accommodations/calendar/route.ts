import {
	createHostifyClientFromEnv,
	HostifyApiError,
	type HostifyClient,
} from "@workspace/core/integrations/hostify";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { withApiRoute } from "@/lib/api/route";
import {
	getListingBookingAvailability,
	type MinimumStayCandidate,
	type VerifyBookableStay,
} from "@/lib/catalog/availability";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

const MAX_MIN_NIGHTS = 5;

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
				? Math.min(parsedMinNights, MAX_MIN_NIGHTS)
				: 1;

		const config = getListingCacheConfig();
		const availability = await getListingBookingAvailability(
			listingId,
			{
				accountId: config.hostifyAccountId,
				provider: HOSTIFY_PROVIDER,
			},
			minNights,
			{
				verifyBookableStay: createStayVerifier(listingId),
			},
		);

		return Response.json({ data: availability });
	},
);

function createStayVerifier(listingId: string): VerifyBookableStay | undefined {
	let client: HostifyClient;
	try {
		client = createHostifyClientFromEnv();
	} catch {
		return undefined;
	}

	return async (stay: MinimumStayCandidate): Promise<boolean> => {
		try {
			const result = await client.listings.price({
				end_date: stay.checkOut,
				guests: 1,
				listing_id: listingId,
				pets: 0,
				start_date: stay.checkIn,
			});
			return result.price.available;
		} catch (error) {
			return !isDefinitiveUnbookableQuoteError(error);
		}
	};
}

function isDefinitiveUnbookableQuoteError(error: unknown): boolean {
	if (!(error instanceof HostifyApiError)) {
		return false;
	}

	const message = (error.providerMessage ?? error.message).toLowerCase();
	return (
		/\b(minimum stay|min stay|min_stay)\b/.test(message) ||
		/\b(unavailable|not available|blocked|occupied|already booked|reserved)\b/.test(
			message,
		)
	);
}
