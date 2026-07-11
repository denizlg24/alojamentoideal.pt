import {
	accommodationListing,
	accommodationListingNight,
	type Database,
	listingReviewSummary,
} from "@workspace/db";
import {
	and,
	arrayContains,
	asc,
	desc,
	eq,
	gte,
	type SQL,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	type CatalogListingDetailDto,
	type CatalogListingSummaryDto,
	toCatalogListingDetail,
	toCatalogListingSummary,
} from "./dto";
import type { CatalogListQuery, CatalogLocale, CatalogRadius } from "./params";

const EARTH_RADIUS_KM = 6371;
const KM_PER_LAT_DEGREE = 111.045;

export interface CatalogScope {
	accountId: string;
	provider: string;
}

export interface CatalogListResult {
	items: CatalogListingSummaryDto[];
	limit: number;
	offset: number;
	total: number;
}

export interface CatalogAmenityFacet {
	count: number;
	key: string;
}

const RECORD_COLUMNS = {
	active: accommodationListing.active,
	bathrooms: accommodationListing.bathrooms,
	bedrooms: accommodationListing.bedrooms,
	beds: accommodationListing.beds,
	city: accommodationListing.city,
	country: accommodationListing.country,
	externalId: accommodationListing.externalId,
	fetchedAt: accommodationListing.fetchedAt,
	latitude: accommodationListing.latitude,
	longitude: accommodationListing.longitude,
	name: accommodationListing.name,
	nickname: accommodationListing.nickname,
	personCapacity: accommodationListing.personCapacity,
	petFriendly: accommodationListing.petFriendly,
	processed: accommodationListing.processed,
	propertyType: accommodationListing.propertyType,
	provider: accommodationListing.provider,
	providerUpdatedAt: accommodationListing.providerUpdatedAt,
	raw: accommodationListing.raw,
	staleAfter: accommodationListing.staleAfter,
	timezone: accommodationListing.timezone,
} as const;

/**
 * Per-listing review aggregate, left-joined so listings without reviews still
 * return a zero count. Combines all sources; see `listingReviewSummary`.
 */
const REVIEW_COLUMNS = {
	reviewAverage: listingReviewSummary.ratingAverage,
	reviewCount: sql<number>`coalesce(${listingReviewSummary.reviewCount}, 0)::int`,
} as const;

/**
 * Per-listing advisory "from" nightly price: the cheapest active, priced future
 * night in the synced calendar. Correlated subquery so it can drive price
 * filtering and sorting on the catalog list without denormalizing a column. The
 * dataset is a single operator's own apartments, so the cost is negligible.
 */
function fromNightlyPrice(): SQL<number | null> {
	return sql<number | null>`(
		select min(${accommodationListingNight.price})
		from ${accommodationListingNight}
		where ${accommodationListingNight.provider} = ${accommodationListing.provider}
			and ${accommodationListingNight.externalAccountId} = ${accommodationListing.externalAccountId}
			and ${accommodationListingNight.listingExternalId} = ${accommodationListing.externalId}
			and ${accommodationListingNight.active} = true
			and ${accommodationListingNight.price} is not null
			and ${accommodationListingNight.date} >= current_date
	)`;
}

function reviewSummaryJoin(): SQL {
	return and(
		eq(listingReviewSummary.provider, accommodationListing.provider),
		eq(
			listingReviewSummary.externalAccountId,
			accommodationListing.externalAccountId,
		),
		eq(listingReviewSummary.listingExternalId, accommodationListing.externalId),
	) as SQL;
}

export class CatalogRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async list(
		query: CatalogListQuery,
		scope: CatalogScope,
	): Promise<CatalogListResult> {
		const conditions = this.#conditions(query, scope);
		const distance = query.radius ? haversineKm(query.radius) : null;
		const now = new Date();

		const rows = await this.#db
			.select({
				...RECORD_COLUMNS,
				...REVIEW_COLUMNS,
				distanceKm: distance ?? sql<number | null>`null`,
			})
			.from(accommodationListing)
			.leftJoin(listingReviewSummary, reviewSummaryJoin())
			.where(and(...conditions))
			.orderBy(...this.#orderBy(query, distance))
			.limit(query.limit)
			.offset(query.offset);

		const [countRow] = await this.#db
			.select({ total: sql<number>`count(*)::int` })
			.from(accommodationListing)
			.leftJoin(listingReviewSummary, reviewSummaryJoin())
			.where(and(...conditions));

		return {
			items: rows.map((row) =>
				toCatalogListingSummary(row, {
					distanceKm: row.distanceKm,
					locale: query.locale,
					now,
				}),
			),
			limit: query.limit,
			offset: query.offset,
			total: countRow?.total ?? 0,
		};
	}

	/**
	 * External IDs of every active listing, for build-time prerendering
	 * (`generateStaticParams`). Ordered for a stable build manifest.
	 */
	async listExternalIds(scope: CatalogScope): Promise<string[]> {
		const rows = await this.#db
			.select({ externalId: accommodationListing.externalId })
			.from(accommodationListing)
			.where(
				and(
					eq(accommodationListing.provider, scope.provider),
					eq(accommodationListing.externalAccountId, scope.accountId),
					eq(accommodationListing.active, true),
				),
			)
			.orderBy(asc(accommodationListing.externalId));

		return rows.map((row) => row.externalId);
	}

	async getByExternalId(
		externalId: string,
		scope: CatalogScope,
		locale: CatalogLocale,
	): Promise<CatalogListingDetailDto | null> {
		const [row] = await this.#db
			.select({ ...RECORD_COLUMNS, ...REVIEW_COLUMNS })
			.from(accommodationListing)
			.leftJoin(listingReviewSummary, reviewSummaryJoin())
			.where(
				and(
					eq(accommodationListing.provider, scope.provider),
					eq(accommodationListing.externalAccountId, scope.accountId),
					eq(accommodationListing.externalId, externalId),
					eq(accommodationListing.active, true),
				),
			)
			.limit(1);

		if (!row) {
			return null;
		}

		return toCatalogListingDetail(row, { locale });
	}

	/**
	 * Distinct amenity filter options across active listings, ordered by how many
	 * listings offer them. Keys are the values indexed on the `amenity_keys`
	 * array (`amenity.id` when present, otherwise the source label), so they feed
	 * straight back into the `amenities` list filter. Presentation (icon, label)
	 * is resolved from the static amenity catalog by the caller. Unnesting the
	 * GIN-indexed array is far cheaper than expanding the processed JSONB.
	 */
	async amenityFacets(
		scope: CatalogScope,
		limit = 24,
	): Promise<CatalogAmenityFacet[]> {
		const result = await this.#db.execute(sql`
			select key, count(*)::int as count
			from (
				select unnest(${accommodationListing.amenityKeys}) as key
				from ${accommodationListing}
				where ${accommodationListing.provider} = ${scope.provider}
					and ${accommodationListing.externalAccountId} = ${scope.accountId}
					and ${accommodationListing.active} = true
			) as keys
			where key is not null and key <> ''
			group by key
			order by count desc, key asc
			limit ${limit}
		`);

		return result.rows.map((row) => ({
			count: Number(row.count),
			key: String(row.key),
		}));
	}

	/**
	 * Min/max advisory nightly price across listings matching the query, ignoring
	 * the query's own price bounds so the homes price slider can show the full
	 * range and let the user widen it. Returns null when no matching listing has a
	 * synced price.
	 */
	async priceBounds(
		query: CatalogListQuery,
		scope: CatalogScope,
	): Promise<{ max: number; min: number } | null> {
		const conditions = this.#conditions(query, scope, false);
		const [row] = await this.#db
			.select({
				max: sql<number | null>`max(${fromNightlyPrice()})`,
				min: sql<number | null>`min(${fromNightlyPrice()})`,
			})
			.from(accommodationListing)
			.leftJoin(listingReviewSummary, reviewSummaryJoin())
			.where(and(...conditions));

		if (!row || row.min === null || row.max === null) {
			return null;
		}

		return {
			max: Math.ceil(Number(row.max)),
			min: Math.floor(Number(row.min)),
		};
	}

	#conditions(
		query: CatalogListQuery,
		scope: CatalogScope,
		includePrice = true,
	): SQL[] {
		const conditions: SQL[] = [
			eq(accommodationListing.provider, scope.provider),
			eq(accommodationListing.externalAccountId, scope.accountId),
		];

		if (!query.includeInactive) {
			conditions.push(eq(accommodationListing.active, true));
		}
		if (query.city) {
			conditions.push(placeMatch(accommodationListing.city, query.city));
		}
		if (query.country) {
			conditions.push(placeMatch(accommodationListing.country, query.country));
		}
		if (query.propertyType) {
			conditions.push(
				placeMatch(accommodationListing.propertyType, query.propertyType),
			);
		}
		if (query.minGuests !== null) {
			conditions.push(
				gte(accommodationListing.personCapacity, query.minGuests),
			);
		}
		if (query.petFriendlyOnly) {
			conditions.push(eq(accommodationListing.petFriendly, true));
		}
		if (query.bedroomsMin !== null) {
			conditions.push(gte(accommodationListing.bedrooms, query.bedroomsMin));
		}
		if (query.bathroomsMin !== null) {
			conditions.push(gte(accommodationListing.bathrooms, query.bathroomsMin));
		}
		if (query.ratingMin !== null) {
			conditions.push(
				sql`coalesce(${listingReviewSummary.ratingAverage}, 0) >= ${query.ratingMin}`,
			);
		}
		if (query.amenities.length > 0) {
			conditions.push(
				arrayContains(accommodationListing.amenityKeys, query.amenities),
			);
		}
		if (query.text) {
			conditions.push(
				sql`${accommodationListing.searchVector} @@ ${tsQuery(query.text)}`,
			);
		}
		if (query.radius) {
			conditions.push(...boundingBox(query.radius));
			conditions.push(
				sql`${haversineKm(query.radius)} <= ${query.radius.radiusKm}`,
			);
		}
		if (includePrice && query.priceMin !== null) {
			conditions.push(sql`${fromNightlyPrice()} >= ${query.priceMin}`);
		}
		if (includePrice && query.priceMax !== null) {
			conditions.push(sql`${fromNightlyPrice()} <= ${query.priceMax}`);
		}

		return conditions;
	}

	#orderBy(query: CatalogListQuery, distance: SQL | null): SQL[] {
		switch (query.sort) {
			case "distance":
				return distance
					? [
							sql`${distance} asc`,
							desc(accommodationListing.providerUpdatedAt),
							desc(accommodationListing.fetchedAt),
						]
					: [
							desc(accommodationListing.fetchedAt),
							desc(accommodationListing.providerUpdatedAt),
						];
			case "relevance":
				return query.text
					? [
							sql`ts_rank(${accommodationListing.searchVector}, ${tsQuery(query.text)}) desc`,
							desc(accommodationListing.providerUpdatedAt),
							desc(accommodationListing.fetchedAt),
						]
					: [
							desc(accommodationListing.providerUpdatedAt),
							desc(accommodationListing.fetchedAt),
						];
			case "capacity":
				return [
					sql`${accommodationListing.personCapacity} desc nulls last`,
					desc(accommodationListing.providerUpdatedAt),
					desc(accommodationListing.fetchedAt),
				];
			case "name":
				return [
					asc(accommodationListing.name),
					desc(accommodationListing.providerUpdatedAt),
					desc(accommodationListing.fetchedAt),
				];
			case "price_asc":
				return [
					sql`${fromNightlyPrice()} asc nulls last`,
					desc(accommodationListing.providerUpdatedAt),
					desc(accommodationListing.fetchedAt),
				];
			case "price_desc":
				return [
					sql`${fromNightlyPrice()} desc nulls last`,
					desc(accommodationListing.providerUpdatedAt),
					desc(accommodationListing.fetchedAt),
				];
			default:
				return [
					sql`${accommodationListing.providerUpdatedAt} desc nulls last`,
					desc(accommodationListing.fetchedAt),
				];
		}
	}
}

/** Accent- and case-insensitive full-text query over the weighted vector. */
function tsQuery(text: string): SQL {
	return sql`websearch_to_tsquery('simple', immutable_unaccent(${text}))`;
}

/**
 * Typo-tolerant place filter: accent/case-insensitive substring OR trigram
 * similarity. Both branches hit the `immutable_unaccent(lower(col))` trigram
 * index.
 */
function placeMatch(column: AnyPgColumn, value: string): SQL {
	const like = `%${value.replace(/[\\%_]/g, "\\$&")}%`;
	const normalized = sql`immutable_unaccent(lower(${column}))`;

	return sql`(${normalized} like immutable_unaccent(lower(${like})) escape '\\'
		or ${normalized} % immutable_unaccent(lower(${value})))`;
}

function haversineKm(radius: CatalogRadius): SQL<number> {
	const lat = radius.latitude;
	const lng = radius.longitude;

	return sql<number>`(${EARTH_RADIUS_KM} * acos(least(1, greatest(-1,
		sin(radians(${lat})) * sin(radians(${accommodationListing.latitude})) +
		cos(radians(${lat})) * cos(radians(${accommodationListing.latitude})) *
		cos(radians(${accommodationListing.longitude}) - radians(${lng}))
	))))`;
}

function boundingBox(radius: CatalogRadius): SQL[] {
	const latDelta = radius.radiusKm / KM_PER_LAT_DEGREE;
	const cosLat = Math.cos((radius.latitude * Math.PI) / 180);
	const lngDelta =
		radius.radiusKm / (KM_PER_LAT_DEGREE * Math.max(Math.abs(cosLat), 1e-6));

	return [
		gte(accommodationListing.latitude, radius.latitude - latDelta),
		sql`${accommodationListing.latitude} <= ${radius.latitude + latDelta}`,
		gte(accommodationListing.longitude, radius.longitude - lngDelta),
		sql`${accommodationListing.longitude} <= ${radius.longitude + lngDelta}`,
	];
}
