import { sql } from "drizzle-orm";
import {
	boolean,
	customType,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Postgres full-text search vector. Modeled so Drizzle owns the column and its
 * GIN index; the value is database-generated from `search_text`.
 */
const tsvector = customType<{ data: string; driverData: string }>({
	dataType() {
		return "tsvector";
	},
});

export interface ListingSectionHashes {
	amenities: string;
	description: string;
	details: string;
	fees: string;
	guide: string;
	location: string;
	photos: string;
	rooms: string;
	status: string;
	title: string;
	translations: string;
}

export interface LocalizedText {
	en: string;
	es: string;
	pt: string;
}

export interface ProcessedAmenity {
	icon: {
		name: string;
		set: "fa6";
	};
	id: string | null;
	labels: LocalizedText;
	sourceLabel: string;
}

export interface AccommodationListingProcessedContent {
	amenities: ProcessedAmenity[];
	description: LocalizedText;
	guide: LocalizedText;
	model: string | null;
	title: LocalizedText;
}

export interface AccommodationListingNormalizedContent {
	amenities: unknown[];
	description: string | null;
	guide: unknown;
	listing: Record<string, unknown>;
	title: string | null;
	translations: unknown[];
}

export interface AccommodationListingRawContent {
	/** Rich description sibling (`{ description, name, house_rules, ... }`). */
	description: unknown;
	/** Structured facts sibling (`{ floor, area, wireless_ssid, ... }`). */
	details: unknown;
	fees: unknown;
	guestGuide: unknown;
	listing: unknown;
	photos: unknown;
	/** Per-room breakdown (`{ name, room_type, person_capacity, beds[] }`). */
	rooms: unknown;
	status: unknown;
	translations: unknown;
}

const timestampWithTimezone = (name: string) =>
	timestamp(name, { withTimezone: true });

/**
 * Better Auth schema (Postgres). Field (JS property) names must match the
 * names Better Auth expects; column names are snake_case. Mirrors the core
 * tables plus the admin plugin fields (role/ban on `user`, impersonatedBy on
 * `session`). Keep in sync with the Better Auth config in `@workspace/auth`.
 */

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	role: text("role").notNull().default("user"),
	banned: boolean("banned").notNull().default(false),
	banReason: text("ban_reason"),
	banExpires: timestamp("ban_expires"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	impersonatedBy: text("impersonated_by"),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const providerSyncRun = pgTable(
	"provider_sync_run",
	{
		id: text("id").primaryKey(),
		error: text("error"),
		finishedAt: timestampWithTimezone("finished_at"),
		listingsCreated: integer("listings_created").notNull().default(0),
		listingsFailed: integer("listings_failed").notNull().default(0),
		listingsSeen: integer("listings_seen").notNull().default(0),
		listingsUnchanged: integer("listings_unchanged").notNull().default(0),
		listingsUpdated: integer("listings_updated").notNull().default(0),
		provider: text("provider").notNull(),
		startedAt: timestampWithTimezone("started_at").notNull().defaultNow(),
		status: text("status").notNull(),
		syncType: text("sync_type").notNull(),
		trigger: text("trigger").notNull(),
	},
	(table) => [
		index("provider_sync_run_provider_started_at_idx").on(
			table.provider,
			table.startedAt,
		),
		index("provider_sync_run_status_idx").on(table.status),
	],
);

export const providerSyncState = pgTable(
	"provider_sync_state",
	{
		id: text("id").primaryKey(),
		activeRunId: text("active_run_id"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		error: text("error"),
		externalAccountId: text("external_account_id").notNull(),
		lastCompletedAt: timestampWithTimezone("last_completed_at"),
		lastStartedAt: timestampWithTimezone("last_started_at"),
		leaseExpiresAt: timestampWithTimezone("lease_expires_at"),
		nextPage: integer("next_page").notNull().default(1),
		nextRunAt: timestampWithTimezone("next_run_at").notNull().defaultNow(),
		provider: text("provider").notNull(),
		status: text("status").notNull().default("idle"),
		syncType: text("sync_type").notNull(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("provider_sync_state_scope_uidx").on(
			table.provider,
			table.externalAccountId,
			table.syncType,
		),
		index("provider_sync_state_next_run_at_idx").on(table.nextRunAt),
		index("provider_sync_state_lease_expires_at_idx").on(table.leaseExpiresAt),
	],
);

export const accommodationListing = pgTable(
	"accommodation_listing",
	{
		id: text("id").primaryKey(),
		active: boolean("active").notNull().default(true),
		amenityKeys: text("amenity_keys")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		bathrooms: doublePrecision("bathrooms"),
		bedrooms: doublePrecision("bedrooms"),
		beds: doublePrecision("beds"),
		city: text("city"),
		country: text("country"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		externalAccountId: text("external_account_id").notNull(),
		externalId: text("external_id").notNull(),
		fetchedAt: timestampWithTimezone("fetched_at").notNull(),
		latitude: doublePrecision("latitude"),
		longitude: doublePrecision("longitude"),
		name: text("name"),
		nickname: text("nickname"),
		normalized: jsonb("normalized")
			.$type<AccommodationListingNormalizedContent>()
			.notNull(),
		personCapacity: doublePrecision("person_capacity"),
		processed: jsonb("processed")
			.$type<AccommodationListingProcessedContent>()
			.notNull(),
		processedAt: timestampWithTimezone("processed_at"),
		processedSourceHash: text("processed_source_hash"),
		processingError: text("processing_error"),
		processingStatus: text("processing_status").notNull().default("pending"),
		propertyType: text("property_type"),
		provider: text("provider").notNull(),
		providerUpdatedAt: timestampWithTimezone("provider_updated_at"),
		raw: jsonb("raw").$type<AccommodationListingRawContent>().notNull(),
		// DB column kept as `search_text` (repurposed as the body/low-weight tier)
		// to avoid a destructive rename in the migration diff.
		searchBody: text("search_text"),
		searchLocation: text("search_location"),
		searchTitle: text("search_title"),
		searchVector: tsvector("search_vector").generatedAlwaysAs(
			sql`setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_title, ''))), 'A')
				|| setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_location, ''))), 'B')
				|| setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_text, ''))), 'C')`,
		),
		sectionHashes: jsonb("section_hashes")
			.$type<ListingSectionHashes>()
			.notNull(),
		sourceHash: text("source_hash").notNull(),
		staleAfter: timestampWithTimezone("stale_after").notNull(),
		syncRunId: text("sync_run_id").references(() => providerSyncRun.id, {
			onDelete: "set null",
		}),
		timezone: text("timezone"),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("accommodation_listing_provider_external_uidx").on(
			table.provider,
			table.externalAccountId,
			table.externalId,
		),
		index("accommodation_listing_active_city_idx").on(table.active, table.city),
		index("accommodation_listing_provider_updated_at_idx").on(
			table.provider,
			table.providerUpdatedAt,
		),
		index("accommodation_listing_stale_after_idx").on(table.staleAfter),
		index("accommodation_listing_lat_lng_idx").on(
			table.latitude,
			table.longitude,
		),
		index("accommodation_listing_search_vector_idx").using(
			"gin",
			table.searchVector,
		),
		index("accommodation_listing_amenity_keys_idx").using(
			"gin",
			table.amenityKeys,
		),
	],
);

export interface AccommodationListingNightRawContent {
	calendar: unknown;
}

export const accommodationListingNight = pgTable(
	"accommodation_listing_night",
	{
		id: text("id").primaryKey(),
		active: boolean("active").notNull().default(true),
		basePrice: doublePrecision("base_price"),
		currency: text("currency"),
		date: date("date", { mode: "string" }).notNull(),
		externalAccountId: text("external_account_id").notNull(),
		fetchedAt: timestampWithTimezone("fetched_at").notNull(),
		listingExternalId: text("listing_external_id").notNull(),
		minStay: integer("min_stay"),
		price: doublePrecision("price"),
		provider: text("provider").notNull(),
		raw: jsonb("raw").$type<AccommodationListingNightRawContent>().notNull(),
		reservationId: text("reservation_id"),
		staleAfter: timestampWithTimezone("stale_after").notNull(),
		status: text("status"),
		syncRunId: text("sync_run_id").references(() => providerSyncRun.id, {
			onDelete: "set null",
		}),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("accommodation_listing_night_scope_date_uidx").on(
			table.provider,
			table.externalAccountId,
			table.listingExternalId,
			table.date,
		),
		index("accommodation_listing_night_date_idx").on(table.date),
		index("accommodation_listing_night_stale_after_idx").on(table.staleAfter),
	],
);

/**
 * Append-only observability event log powering analytics and the future admin
 * dashboard. Rows are written best-effort from the application and must never
 * block the request path. Technical error telemetry lives in Sentry; this table
 * is the durable, queryable source for product/usage analytics.
 */
export const observabilityEvent = pgTable(
	"observability_event",
	{
		id: text("id").primaryKey(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		durationMs: integer("duration_ms"),
		ipHash: text("ip_hash"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		method: text("method"),
		name: text("name").notNull(),
		occurredAt: timestampWithTimezone("occurred_at").notNull().defaultNow(),
		provider: text("provider"),
		requestId: text("request_id"),
		route: text("route"),
		severity: text("severity").notNull().default("info"),
		source: text("source"),
		statusCode: integer("status_code"),
		type: text("type").notNull(),
		userId: text("user_id"),
	},
	(table) => [
		index("observability_event_type_occurred_at_idx").on(
			table.type,
			table.occurredAt,
		),
		index("observability_event_occurred_at_idx").on(table.occurredAt),
		index("observability_event_name_idx").on(table.name),
		index("observability_event_route_idx").on(table.route),
		index("observability_event_status_code_idx").on(table.statusCode),
	],
);

/**
 * Individual guest reviews for a listing. `source` discriminates between
 * reviews mirrored from an external provider (`external`, e.g. Hostify) and
 * reviews authored inside this app (`internal`). Internal reviews reference the
 * authoring `user`; external reviews carry the provider's review id in
 * `externalId`. Aggregates the UI reads from live in `listingReviewSummary`.
 */
export const listingReview = pgTable(
	"listing_review",
	{
		id: text("id").primaryKey(),
		source: text("source").notNull(),
		// Distribution channel the review originated from (`airbnb`, `booking`,
		// `internal`, ...). `source` stays the external/internal split; `channel`
		// records the specific origin so the UI can route back to it.
		channel: text("channel"),
		provider: text("provider").notNull(),
		externalAccountId: text("external_account_id").notNull(),
		// Provider review id for external reviews; null for internal reviews.
		externalId: text("external_id"),
		// Review id on the originating channel (e.g. the Airbnb/Booking review id).
		channelReviewId: text("channel_review_id"),
		// Public/parent listing the review is attributed to.
		listingExternalId: text("listing_external_id").notNull(),
		// Channel-specific child listing the review actually came from. Hostify
		// mirrors each channel onto its own child listing under the parent.
		channelListingExternalId: text("channel_listing_external_id"),
		reservationId: text("reservation_id"),
		guestId: text("guest_id"),
		guestName: text("guest_name"),
		// Author of an internal review; null for external reviews.
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		rating: doublePrecision("rating"),
		accuracyRating: doublePrecision("accuracy_rating"),
		checkinRating: doublePrecision("checkin_rating"),
		cleanRating: doublePrecision("clean_rating"),
		communicationRating: doublePrecision("communication_rating"),
		locationRating: doublePrecision("location_rating"),
		valueRating: doublePrecision("value_rating"),
		comments: text("comments"),
		language: text("language"),
		status: text("status").notNull().default("published"),
		reviewedAt: timestampWithTimezone("reviewed_at"),
		raw: jsonb("raw").$type<Record<string, unknown>>(),
		syncRunId: text("sync_run_id").references(() => providerSyncRun.id, {
			onDelete: "set null",
		}),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		// External reviews dedupe on (scope, source, providerReviewId). Internal
		// reviews keep externalId null; Postgres treats nulls as distinct so they
		// are never collapsed by this index.
		uniqueIndex("listing_review_provider_source_external_uidx").on(
			table.provider,
			table.externalAccountId,
			table.source,
			table.externalId,
		),
		index("listing_review_listing_idx").on(
			table.provider,
			table.externalAccountId,
			table.listingExternalId,
		),
		index("listing_review_source_idx").on(table.source),
		index("listing_review_channel_idx").on(
			table.provider,
			table.externalAccountId,
			table.listingExternalId,
			table.channel,
		),
	],
);

/**
 * Denormalized per-listing review aggregate the catalog read path joins for the
 * rating badge. Combines all sources; `externalCount`/`internalCount` keep the
 * split available so we can show them separately later. Recomputed by the
 * reviews sync whenever a listing's reviews change.
 */
export const listingReviewSummary = pgTable(
	"listing_review_summary",
	{
		id: text("id").primaryKey(),
		provider: text("provider").notNull(),
		externalAccountId: text("external_account_id").notNull(),
		listingExternalId: text("listing_external_id").notNull(),
		reviewCount: integer("review_count").notNull().default(0),
		ratingAverage: doublePrecision("rating_average"),
		externalCount: integer("external_count").notNull().default(0),
		internalCount: integer("internal_count").notNull().default(0),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("listing_review_summary_scope_uidx").on(
			table.provider,
			table.externalAccountId,
			table.listingExternalId,
		),
	],
);

export const schema = {
	user,
	session,
	account,
	verification,
	providerSyncRun,
	providerSyncState,
	accommodationListing,
	accommodationListingNight,
	observabilityEvent,
	listingReview,
	listingReviewSummary,
};
