import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	customType,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	numeric,
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
		versionHash: integer("version_hash").notNull().default(0),
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

export interface AccommodationQuoteFeeSnapshot {
	amountMinor: number | null;
	chargeLabel: string | null;
	inclusiveTaxMinor: number | null;
	isBasePrice: boolean;
	name: string;
	providerPayload: Record<string, unknown> | null;
	quantity: number | null;
	totalMinor: number;
	type: string;
}

export interface CommerceCatalogSnapshot {
	city: string | null;
	country: string | null;
	imageUrl: string | null;
	listingId: string;
	locationLabel: string | null;
	provider: string;
	title: string;
}

export interface OrderBillingAddressSnapshot {
	city?: string;
	country?: string;
	line1?: string;
	line2?: string;
	postalCode?: string;
	region?: string;
	// Preserve provider/frontend address details not yet promoted to first-class fields.
	[key: string]: unknown;
}

/**
 * Provenance and resolved value of a Stripe coupon currently applied to a cart
 * or frozen onto an order. Stripe owns the coupon/promotion-code rules; this
 * captures the authoritative server-side resolution at apply time so totals can
 * be recomputed without re-hitting Stripe on every mutation.
 */
export interface AppliedDiscountSnapshot {
	source: "stripe";
	couponId: string;
	/** The promotion code the customer entered (null for bare coupon ids). */
	promotionCode: string | null;
	type: "percentage" | "fixed";
	/** Percentage coupons only. 1000 = 10%. */
	percentBasisPoints: number | null;
	/** Fixed coupons only, in cart currency minor units. */
	amountMinor: number | null;
	currency: string | null;
}

export const cart = pgTable(
	"carts",
	{
		id: text("id").primaryKey(),
		appliedDiscount: jsonb("applied_discount").$type<AppliedDiscountSnapshot>(),
		cartToken: text("cart_token").notNull(),
		convertedOrderId: text("converted_order_id"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		discountMinor: bigint("discount_minor", { mode: "number" })
			.notNull()
			.default(0),
		expiresAt: timestampWithTimezone("expires_at").notNull(),
		itemCount: integer("item_count").notNull().default(0),
		status: text("status").notNull().default("draft"),
		subtotalMinor: bigint("subtotal_minor", { mode: "number" })
			.notNull()
			.default(0),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		uniqueIndex("carts_cart_token_uidx").on(table.cartToken),
		index("carts_status_expires_at_idx").on(table.status, table.expiresAt),
		index("carts_user_id_idx").on(table.userId),
		// All monetary columns are non-negative minor units. discount_minor is a
		// positive amount subtracted from total_minor (see computeDiscountMinor),
		// never stored as a negative value.
		check("carts_subtotal_minor_nonneg", sql`${table.subtotalMinor} >= 0`),
		check("carts_tax_minor_nonneg", sql`${table.taxMinor} >= 0`),
		check("carts_total_minor_nonneg", sql`${table.totalMinor} >= 0`),
		check("carts_discount_minor_nonneg", sql`${table.discountMinor} >= 0`),
	],
);

export const accommodationQuoteSnapshot = pgTable(
	"accommodation_quote_snapshots",
	{
		id: text("id").primaryKey(),
		adults: integer("adults").notNull(),
		checkIn: date("check_in", { mode: "string" }).notNull(),
		checkOut: date("check_out", { mode: "string" }).notNull(),
		children: integer("children").notNull().default(0),
		cleaningFeeMinor: bigint("cleaning_fee_minor", {
			mode: "number",
		}),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		expiresAt: timestampWithTimezone("expires_at").notNull(),
		externalAccountId: text("external_account_id").notNull(),
		feeLines: jsonb("fee_lines")
			.$type<AccommodationQuoteFeeSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		fetchedAt: timestampWithTimezone("fetched_at").notNull(),
		guests: integer("guests").notNull(),
		housingFeeMinor: bigint("housing_fee_minor", { mode: "number" }),
		infants: integer("infants").notNull().default(0),
		listingExternalId: text("listing_external_id").notNull(),
		nightlyAverageMinor: bigint("nightly_average_minor", {
			mode: "number",
		}),
		nights: integer("nights").notNull(),
		pets: integer("pets").notNull().default(0),
		provider: text("provider").notNull(),
		providerPayload: jsonb("provider_payload").$type<Record<string, unknown>>(),
		subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
		validationStatus: text("validation_status").notNull().default("valid"),
	},
	(table) => [
		index("accommodation_quote_snapshots_scope_dates_idx").on(
			table.provider,
			table.externalAccountId,
			table.listingExternalId,
			table.checkIn,
			table.checkOut,
		),
		index("accommodation_quote_snapshots_expires_at_idx").on(table.expiresAt),
		index("accommodation_quote_snapshots_validation_status_idx").on(
			table.validationStatus,
		),
		// Nullable fee columns: the check passes when the value is NULL.
		check(
			"accommodation_quote_snapshots_cleaning_fee_nonneg",
			sql`${table.cleaningFeeMinor} >= 0`,
		),
		check(
			"accommodation_quote_snapshots_housing_fee_nonneg",
			sql`${table.housingFeeMinor} >= 0`,
		),
		check(
			"accommodation_quote_snapshots_nightly_average_nonneg",
			sql`${table.nightlyAverageMinor} >= 0`,
		),
		check(
			"accommodation_quote_snapshots_subtotal_minor_nonneg",
			sql`${table.subtotalMinor} >= 0`,
		),
		check(
			"accommodation_quote_snapshots_tax_minor_nonneg",
			sql`${table.taxMinor} >= 0`,
		),
		check(
			"accommodation_quote_snapshots_total_minor_nonneg",
			sql`${table.totalMinor} >= 0`,
		),
	],
);

export const cartItem = pgTable(
	"cart_items",
	{
		id: text("id").primaryKey(),
		cartId: text("cart_id")
			.notNull()
			.references(() => cart.id, { onDelete: "cascade" }),
		clientMutationId: text("client_mutation_id"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		position: integer("position").notNull(),
		quoteSnapshotId: text("quote_snapshot_id")
			.notNull()
			.references(() => accommodationQuoteSnapshot.id, {
				onDelete: "restrict",
			}),
		removedAt: timestampWithTimezone("removed_at"),
		status: text("status").notNull().default("active"),
		type: text("type").notNull().default("accommodation"),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("cart_items_cart_status_idx").on(table.cartId, table.status),
		uniqueIndex("cart_items_cart_position_uidx").on(
			table.cartId,
			table.position,
		),
		uniqueIndex("cart_items_client_mutation_uidx")
			.on(table.cartId, table.clientMutationId)
			.where(sql`${table.clientMutationId} is not null`),
	],
);

export const order = pgTable(
	"orders",
	{
		id: text("id").primaryKey(),
		amountPaidMinor: bigint("amount_paid_minor", { mode: "number" })
			.notNull()
			.default(0),
		appliedDiscount: jsonb("applied_discount").$type<AppliedDiscountSnapshot>(),
		amountRefundedMinor: bigint("amount_refunded_minor", { mode: "number" })
			.notNull()
			.default(0),
		cancelledAt: timestampWithTimezone("cancelled_at"),
		cartId: text("cart_id").references(() => cart.id, { onDelete: "set null" }),
		checkoutExpiresAt: timestampWithTimezone("checkout_expires_at"),
		confirmedAt: timestampWithTimezone("confirmed_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		discountMinor: bigint("discount_minor", { mode: "number" })
			.notNull()
			.default(0),
		failureCode: text("failure_code"),
		failureDetail: text("failure_detail"),
		publicReference: text("public_reference").notNull(),
		status: text("status").notNull().default("draft"),
		subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		uniqueIndex("orders_public_reference_uidx").on(table.publicReference),
		index("orders_cart_id_idx").on(table.cartId),
		index("orders_status_created_at_idx").on(table.status, table.createdAt),
		index("orders_user_id_idx").on(table.userId),
		// Monetary columns are non-negative minor units (discount_minor is a
		// positive amount subtracted from total_minor, mirroring carts).
		check("orders_subtotal_minor_nonneg", sql`${table.subtotalMinor} >= 0`),
		check("orders_tax_minor_nonneg", sql`${table.taxMinor} >= 0`),
		check("orders_total_minor_nonneg", sql`${table.totalMinor} >= 0`),
		check("orders_discount_minor_nonneg", sql`${table.discountMinor} >= 0`),
		check(
			"orders_amount_paid_minor_nonneg",
			sql`${table.amountPaidMinor} >= 0`,
		),
		check(
			"orders_amount_refunded_minor_nonneg",
			sql`${table.amountRefundedMinor} >= 0`,
		),
	],
);

export const orderContact = pgTable(
	"order_contacts",
	{
		id: text("id").primaryKey(),
		billingAddress: jsonb("billing_address")
			.$type<OrderBillingAddressSnapshot>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		companyName: text("company_name"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		email: text("email").notNull(),
		isCompany: boolean("is_company").notNull().default(false),
		name: text("name").notNull(),
		notes: text("notes"),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		phoneE164: text("phone_e164").notNull(),
		taxNumber: text("tax_number"),
	},
	(table) => [
		uniqueIndex("order_contacts_order_id_uidx").on(table.orderId),
		index("order_contacts_email_idx").on(table.email),
	],
);

export const orderItem = pgTable(
	"order_items",
	{
		id: text("id").primaryKey(),
		catalogSnapshot: jsonb("catalog_snapshot")
			.$type<CommerceCatalogSnapshot>()
			.notNull(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		discountMinor: bigint("discount_minor", { mode: "number" })
			.notNull()
			.default(0),
		imageUrlSnapshot: text("image_url_snapshot"),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		quantity: integer("quantity").notNull().default(1),
		sourceCartItemId: text("source_cart_item_id").references(
			() => cartItem.id,
			{
				onDelete: "set null",
			},
		),
		status: text("status").notNull().default("draft"),
		subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		titleSnapshot: text("title_snapshot").notNull(),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
		type: text("type").notNull(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("order_items_order_id_idx").on(table.orderId),
		uniqueIndex("order_items_order_position_uidx").on(
			table.orderId,
			table.position,
		),
		// Monetary columns are non-negative minor units (discount_minor positive,
		// subtracted from total_minor).
		check(
			"order_items_subtotal_minor_nonneg",
			sql`${table.subtotalMinor} >= 0`,
		),
		check("order_items_tax_minor_nonneg", sql`${table.taxMinor} >= 0`),
		check("order_items_total_minor_nonneg", sql`${table.totalMinor} >= 0`),
		check(
			"order_items_discount_minor_nonneg",
			sql`${table.discountMinor} >= 0`,
		),
	],
);

export const accommodationItemDetail = pgTable(
	"accommodation_item_details",
	{
		orderItemId: text("order_item_id")
			.primaryKey()
			.references(() => orderItem.id, { onDelete: "cascade" }),
		adults: integer("adults").notNull().default(0),
		checkIn: date("check_in", { mode: "string" }).notNull(),
		checkOut: date("check_out", { mode: "string" }).notNull(),
		children: integer("children").notNull().default(0),
		externalAccountId: text("external_account_id").notNull(),
		guests: integer("guests").notNull(),
		hostifyListingId: text("hostify_listing_id").notNull(),
		infants: integer("infants").notNull().default(0),
		nights: integer("nights").notNull(),
		pets: integer("pets").notNull().default(0),
		propertyTimezone: text("property_timezone").notNull(),
		provider: text("provider").notNull(),
	},
	(table) => [
		index("accommodation_item_details_listing_idx").on(
			table.provider,
			table.externalAccountId,
			table.hostifyListingId,
		),
	],
);

export const orderItemCharge = pgTable(
	"order_item_charges",
	{
		id: text("id").primaryKey(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		grossMinor: bigint("gross_minor", { mode: "number" }).notNull(),
		kind: text("kind").notNull(),
		name: text("name").notNull(),
		netMinor: bigint("net_minor", { mode: "number" }).notNull(),
		orderItemId: text("order_item_id")
			.notNull()
			.references(() => orderItem.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		providerChargeId: text("provider_charge_id"),
		quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
		rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		taxRateBasisPoints: integer("tax_rate_basis_points"),
		unitNetMinor: bigint("unit_net_minor", { mode: "number" }).notNull(),
	},
	(table) => [
		index("order_item_charges_order_item_id_idx").on(table.orderItemId),
		uniqueIndex("order_item_charges_item_position_uidx").on(
			table.orderItemId,
			table.position,
		),
		// gross/net/unit_net are intentionally signed: discount charge rows store
		// negative amounts (see buildDiscountChargeRow). Only tax is non-negative.
		check("order_item_charges_tax_minor_nonneg", sql`${table.taxMinor} >= 0`),
	],
);

export const apiIdempotencyKey = pgTable(
	"api_idempotency_keys",
	{
		id: text("id").primaryKey(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		expiresAt: timestampWithTimezone("expires_at").notNull(),
		key: text("key").notNull(),
		requestHash: text("request_hash").notNull(),
		responseSnapshot: jsonb("response_snapshot").$type<unknown>(),
		scope: text("scope").notNull(),
		status: text("status").notNull().default("in_progress"),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("api_idempotency_keys_scope_key_uidx").on(
			table.scope,
			table.key,
		),
		index("api_idempotency_keys_expires_at_idx").on(table.expiresAt),
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
	cart,
	cartItem,
	accommodationQuoteSnapshot,
	order,
	orderContact,
	orderItem,
	accommodationItemDetail,
	orderItemCharge,
	apiIdempotencyKey,
};
