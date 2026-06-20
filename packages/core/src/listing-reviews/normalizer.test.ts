import { describe, expect, test } from "bun:test";
import type { HostifyReview } from "../integrations/hostify/index";
import {
	type BuildListingReviewProjectionOptions,
	buildListingReviewProjection,
} from "./normalizer";

function review(overrides: Partial<HostifyReview> = {}): HostifyReview {
	return {
		accuracy_rating: 5,
		checkin_rating: 4,
		clean_rating: 5,
		comments: "  Lovely stay  ",
		communication_rating: 5,
		created: "2026-05-01T10:00:00Z",
		guest_id: 42,
		id: 1001,
		listing_id: 7,
		location_rating: 4,
		rating: 4.5,
		reservation_id: 88,
		value_rating: 4,
		...overrides,
	} as HostifyReview;
}

const options: BuildListingReviewProjectionOptions = {
	channel: "airbnb",
	listingExternalId: "7",
};

describe("buildListingReviewProjection", () => {
	test("maps and stringifies ids, trims comments, parses created", () => {
		const projection = buildListingReviewProjection(review(), options);

		expect(projection.externalId).toBe("1001");
		expect(projection.listingExternalId).toBe("7");
		expect(projection.channel).toBe("airbnb");
		expect(projection.source).toBe("external");
		expect(projection.channelListingExternalId).toBe("7");
		expect(projection.reservationId).toBe("88");
		expect(projection.guestId).toBe("42");
		expect(projection.rating).toBe(4.5);
		expect(projection.comments).toBe("Lovely stay");
		expect(projection.reviewedAt).toEqual(new Date("2026-05-01T10:00:00Z"));
	});

	test("attributes the review to the parent listing when present", () => {
		const projection = buildListingReviewProjection(
			review({ listing_id: 700058370, parent_listing_id: 700016985 }),
			{ channel: "airbnb", listingExternalId: "700016985" },
		);

		expect(projection.listingExternalId).toBe("700016985");
		expect(projection.channelListingExternalId).toBe("700058370");
	});

	test("rescales booking ratings from 0-10 to 0-5", () => {
		const projection = buildListingReviewProjection(
			review({ clean_rating: 10, location_rating: 7.5, rating: 8 }),
			{ channel: "booking", listingExternalId: "7" },
		);

		expect(projection.rating).toBe(4);
		expect(projection.cleanRating).toBe(5);
		expect(projection.locationRating).toBe(3.75);
	});

	test("marks internal-channel reviews as internal source", () => {
		const projection = buildListingReviewProjection(review(), {
			channel: "internal",
			listingExternalId: "7",
		});

		expect(projection.source).toBe("internal");
	});

	test("coerces missing optional fields to null", () => {
		const projection = buildListingReviewProjection(
			review({
				channel_review_id: null,
				comments: null,
				created: null,
				rating: null,
				reservation_id: null,
			}),
			options,
		);

		expect(projection.comments).toBeNull();
		expect(projection.rating).toBeNull();
		expect(projection.channelReviewId).toBeNull();
		expect(projection.reservationId).toBeNull();
		expect(projection.reviewedAt).toBeNull();
	});

	test("throws when the review id is missing", () => {
		expect(() =>
			buildListingReviewProjection(review({ id: undefined }), options),
		).toThrow(/missing an id/);
	});
});
