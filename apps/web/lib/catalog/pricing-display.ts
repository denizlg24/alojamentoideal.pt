import type {
	AccommodationSearchListing,
	NightlyPriceSummary,
} from "@workspace/core/accommodations";

/**
 * Client-safe pricing helpers (types, formatting, card/popup copy). Kept apart
 * from `pricing.ts` so Client Components can import them without pulling in the
 * server-only `"use cache"` advisory-price read.
 */

/** Price figures a listing card needs to render a rate. */
export interface ListingCardPrice {
	currency: string;
	/** True when `total` is a base-price estimate (excludes fees), not a quote. */
	estimated: boolean;
	nightlyFrom: number | null;
	nights: number | null;
	total: number | null;
}

/** Builds the card-price map for a non-date-aware (advisory) listing render. */
export function advisoryPriceMap(
	summaries: NightlyPriceSummary[],
): Map<string, ListingCardPrice> {
	return new Map(
		summaries.map((summary) => [
			summary.listingId,
			{
				currency: summary.currency,
				estimated: false,
				nightlyFrom: summary.fromPrice,
				nights: null,
				total: null,
			},
		]),
	);
}

/**
 * Builds the card-price map for a date-aware search render. Uses the synced
 * base-price estimate ("from X for Y nights") when the full stay is priced,
 * otherwise falls back to the advisory "from" nightly rate.
 */
export function searchPriceMap(
	items: AccommodationSearchListing[],
): Map<string, ListingCardPrice> {
	return new Map(
		items.map((item): [string, ListingCardPrice] => {
			if (item.estimate) {
				return [
					item.listing.id,
					{
						currency: item.estimate.currency,
						estimated: true,
						nightlyFrom:
							item.estimate.nights > 0
								? Math.round(item.estimate.total / item.estimate.nights)
								: null,
						nights: item.estimate.nights,
						total: item.estimate.total,
					},
				];
			}

			return [
				item.listing.id,
				{
					currency: item.advisoryPricing?.currency ?? "EUR",
					estimated: false,
					nightlyFrom: item.advisoryPricing?.fromPrice ?? null,
					nights: null,
					total: null,
				},
			];
		}),
	);
}

/** Formats a whole-euro (or other currency) figure for display. */
export function formatListingMoney(amount: number, currency: string): string {
	return new Intl.NumberFormat("en", {
		currency,
		maximumFractionDigits: 0,
		minimumFractionDigits: 0,
		style: "currency",
	}).format(amount);
}

export interface ListingPriceDisplay {
	lead: string | null;
	main: string;
	sub: string;
}

/**
 * Shared price-block copy for listing cards and map popups. A live quote renders
 * the stay total; otherwise the advisory "from" nightly rate. Missing pricing is
 * intentionally displayed as unknown so we do not imply a rate we do not have.
 */
export function listingPriceDisplay(
	price: ListingCardPrice | undefined,
	_listingId: string,
): ListingPriceDisplay {
	if (!price) {
		return { lead: null, main: "---", sub: "" };
	}

	if (price.total !== null && price.nights !== null) {
		const nightsLabel = `${price.nights} ${price.nights === 1 ? "night" : "nights"}`;
		return {
			lead: price.estimated ? "from" : null,
			main: formatListingMoney(price.total, price.currency),
			sub: price.estimated ? nightsLabel : `${nightsLabel} total`,
		};
	}

	if (price.nightlyFrom !== null) {
		return {
			lead: "as low as",
			main: formatListingMoney(price.nightlyFrom, price.currency),
			sub: "per night",
		};
	}

	return { lead: null, main: "---", sub: "" };
}
