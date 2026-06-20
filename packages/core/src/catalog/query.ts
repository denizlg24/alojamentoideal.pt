import {
	accommodationListing,
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

	#conditions(query: CatalogListQuery, scope: CatalogScope): SQL[] {
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
		if (query.bedroomsMin !== null) {
			conditions.push(gte(accommodationListing.bedrooms, query.bedroomsMin));
		}
		if (query.bathroomsMin !== null) {
			conditions.push(gte(accommodationListing.bathrooms, query.bathroomsMin));
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
