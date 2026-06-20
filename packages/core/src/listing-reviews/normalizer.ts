import type { HostifyReview } from "../integrations/hostify/index";

export interface ListingReviewProjection {
	accuracyRating: number | null;
	channel: string;
	channelListingExternalId: string | null;
	channelReviewId: string | null;
	checkinRating: number | null;
	cleanRating: number | null;
	comments: string | null;
	communicationRating: number | null;
	externalId: string;
	guestId: string | null;
	listingExternalId: string;
	locationRating: number | null;
	rating: number | null;
	raw: Record<string, unknown>;
	reservationId: string | null;
	reviewedAt: Date | null;
	source: "external" | "internal";
	valueRating: number | null;
}

const TARGET_SCALE = 5;

/**
 * Hostify mirrors each channel's native rating scale. Airbnb/Vrbo/Expedia and
 * our own reviews are already 0-5; Booking is 0-10. Channels not listed here
 * default to 0-5 — add new 10-point channels explicitly.
 */
const CHANNEL_RATING_SCALE: Record<string, number> = {
	booking: 10,
};

const INTERNAL_CHANNEL = "internal";

export interface BuildListingReviewProjectionOptions {
	channel: string;
	/**
	 * Public/parent listing the sync is currently fetching. Used as the listing
	 * attribution when the review omits `parent_listing_id`.
	 */
	listingExternalId: string;
}

export function buildListingReviewProjection(
	review: HostifyReview,
	options: BuildListingReviewProjectionOptions,
): ListingReviewProjection {
	const externalId = toIdString(review.id);
	if (externalId === null) {
		throw new Error("Hostify review is missing an id");
	}

	const listingExternalId =
		toIdString(review.parent_listing_id) ??
		toIdString(review.listing_id) ??
		options.listingExternalId;

	const channel = options.channel;
	const scale = CHANNEL_RATING_SCALE[channel] ?? TARGET_SCALE;

	return {
		accuracyRating: normalizeRating(review.accuracy_rating, scale),
		channel,
		channelListingExternalId: toIdString(review.listing_id),
		channelReviewId: toIdString(review.channel_review_id),
		checkinRating: normalizeRating(review.checkin_rating, scale),
		cleanRating: normalizeRating(review.clean_rating, scale),
		comments: toText(review.comments),
		communicationRating: normalizeRating(review.communication_rating, scale),
		externalId,
		guestId: toIdString(review.guest_id),
		listingExternalId,
		locationRating: normalizeRating(review.location_rating, scale),
		rating: normalizeRating(review.rating, scale),
		raw: review as Record<string, unknown>,
		reservationId: toIdString(review.reservation_id),
		reviewedAt: toDate(review.created),
		source: channel === INTERNAL_CHANNEL ? "internal" : "external",
		valueRating: normalizeRating(review.value_rating, scale),
	};
}

function normalizeRating(
	value: number | null | undefined,
	scale: number,
): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}

	return (value * TARGET_SCALE) / scale;
}

function toIdString(value: string | number | null | undefined): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	return typeof value === "number" ? String(value) : null;
}

function toText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function toDate(value: string | null | undefined): Date | null {
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}
