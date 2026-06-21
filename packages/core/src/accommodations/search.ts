import type {
	CatalogListingSummaryDto,
	CatalogListQuery,
	CatalogRepository,
	CatalogScope,
} from "../catalog/index";
import type {
	AccommodationPricingRepository,
	StayAvailability,
} from "./repository";

export interface AccommodationSearchInput {
	candidateLimit: number;
	dates: {
		checkIn: string;
		checkOut: string;
		nights: number;
	} | null;
	guests: number | null;
	query: CatalogListQuery;
	scope: CatalogScope;
}

export interface AccommodationSearchListing {
	advisoryPricing: {
		currency: string;
		fromPrice: number | null;
	} | null;
	estimate: {
		currency: string;
		nights: number;
		total: number;
	} | null;
	listing: CatalogListingSummaryDto;
}

export interface AccommodationSearchResult {
	items: AccommodationSearchListing[];
	limit: number;
	offset: number;
	priceBounds: { max: number; min: number } | null;
	total: number;
}

interface AccommodationSearchServiceOptions {
	catalog: CatalogRepository;
	currency: string;
	pricing: AccommodationPricingRepository;
}

/**
 * Date-aware homes search served entirely from our own Postgres mirror: catalog
 * candidates filtered by the synced nightly calendar, with a base-price estimate
 * per stay. No Hostify call sits on this path; the live quote is deferred to the
 * listing detail and checkout, where availability is re-validated against
 * Hostify before payment.
 *
 * Price filtering and `price_asc`/`price_desc` sorting run on a per-night basis
 * (the dated estimate's average nightly, the advisory "from" rate otherwise) so
 * the slider unit stays consistent whether or not a stay is selected.
 */
export class AccommodationSearchService {
	readonly #catalog: CatalogRepository;
	readonly #currency: string;
	readonly #pricing: AccommodationPricingRepository;

	constructor(options: AccommodationSearchServiceOptions) {
		this.#catalog = options.catalog;
		this.#currency = options.currency;
		this.#pricing = options.pricing;
	}

	async search(
		input: AccommodationSearchInput,
	): Promise<AccommodationSearchResult> {
		if (!input.dates || !input.guests) {
			const [catalogResult, priceBounds] = await Promise.all([
				this.#catalog.list(input.query, input.scope),
				this.#catalog.priceBounds(input.query, input.scope),
			]);
			const pricing = await this.#pricing.fromPricesForListings(input.scope, {
				currency: this.#currency,
				listingIds: catalogResult.items.map((item) => item.id),
			});

			return {
				items: catalogResult.items.map((listing) => {
					const summary = pricing.get(listing.id);
					return {
						advisoryPricing: summary
							? { currency: summary.currency, fromPrice: summary.fromPrice }
							: null,
						estimate: null,
						listing,
					};
				}),
				limit: catalogResult.limit,
				offset: catalogResult.offset,
				priceBounds,
				total: catalogResult.total,
			};
		}

		const dates = input.dates;
		const isPriceSort =
			input.query.sort === "price_asc" || input.query.sort === "price_desc";
		const candidateQuery: CatalogListQuery = {
			...input.query,
			limit: input.candidateLimit,
			offset: 0,
			priceMax: null,
			priceMin: null,
			sort: isPriceSort ? "recent" : input.query.sort,
		};
		const catalogResult = await this.#catalog.list(candidateQuery, input.scope);
		const availability = await this.#pricing.availabilityForStay(input.scope, {
			checkIn: dates.checkIn,
			checkOut: dates.checkOut,
			currency: this.#currency,
			listingIds: catalogResult.items.map((item) => item.id),
			nights: dates.nights,
		});

		const nightlyOf = (stay: StayAvailability): number | null =>
			stay.total !== null && dates.nights > 0
				? Math.round(stay.total / dates.nights)
				: stay.nightlyFrom;

		const available: {
			listing: CatalogListingSummaryDto;
			stay: StayAvailability;
		}[] = [];
		for (const listing of catalogResult.items) {
			const stay = availability.get(listing.id);
			if (stay?.available) {
				available.push({ listing, stay });
			}
		}

		const nightlies = available
			.map((entry) => nightlyOf(entry.stay))
			.filter((value): value is number => value !== null);
		const priceBounds = nightlies.length
			? {
					max: Math.ceil(Math.max(...nightlies)),
					min: Math.floor(Math.min(...nightlies)),
				}
			: null;

		const { priceMax, priceMin } = input.query;
		let matched =
			priceMin === null && priceMax === null
				? available
				: available.filter((entry) => {
						const nightly = nightlyOf(entry.stay);
						if (nightly === null) return false;
						if (priceMin !== null && nightly < priceMin) return false;
						if (priceMax !== null && nightly > priceMax) return false;
						return true;
					});

		if (isPriceSort) {
			matched = [...matched].sort((a, b) => {
				const av = nightlyOf(a.stay);
				const bv = nightlyOf(b.stay);
				if (av === null) return 1;
				if (bv === null) return -1;
				return input.query.sort === "price_asc" ? av - bv : bv - av;
			});
		}

		const page = matched.slice(
			input.query.offset,
			input.query.offset + input.query.limit,
		);

		return {
			items: page.map(({ listing, stay }) => ({
				advisoryPricing:
					stay.total === null && stay.nightlyFrom !== null
						? { currency: stay.currency, fromPrice: stay.nightlyFrom }
						: null,
				estimate:
					stay.total !== null
						? {
								currency: stay.currency,
								nights: stay.nights,
								total: stay.total,
							}
						: null,
				listing,
			})),
			limit: input.query.limit,
			offset: input.query.offset,
			priceBounds,
			total: matched.length,
		};
	}
}
