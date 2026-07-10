import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	customType,
	date,
	doublePrecision,
	foreignKey,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return "bytea";
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
	descriptionSections?: Record<string, LocalizedText>;
	guide: LocalizedText;
	model: string | null;
	title: LocalizedText;
}

export interface AccommodationListingNormalizedContent {
	amenities: unknown[];
	description: string | null;
	descriptionSections?: Record<string, string>;
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
	dateOfBirth: date("date_of_birth"),
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

/**
 * Lifecycle of a user's Stripe Identity verification. Mirrors the Stripe
 * VerificationSession statuses plus `unstarted` for the pre-session state.
 */
export type IdentityVerificationStatus =
	| "unstarted"
	| "processing"
	| "requires_input"
	| "verified"
	| "canceled";

export type IdentityDocumentStatus = Exclude<
	IdentityVerificationStatus,
	"unstarted"
>;

export type IdentityDocumentSource = "stripe_identity";

export type ProviderBookingStatus =
	| "pending"
	| "confirmed"
	| "cancelled"
	| "failed"
	| "completed";

export type BookingGuestIdentityStatus =
	| "missing"
	| "provided"
	| "processing"
	| "requires_input"
	| "verified"
	| "canceled";

export type GuestSubmissionJobStatus =
	| "pending"
	| "running"
	| "retrying"
	| "succeeded"
	| "failed"
	| "canceled";

export const userIdentityDocument = pgTable(
	"user_identity_documents",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		source: text("source")
			.$type<IdentityDocumentSource>()
			.notNull()
			.default("stripe_identity"),
		status: text("status")
			.$type<IdentityDocumentStatus>()
			.notNull()
			.default("requires_input"),
		stripeVerificationSessionId: text("stripe_verification_session_id"),
		stripeVerificationReportId: text("stripe_verification_report_id"),
		// Encrypted identity columns must be encrypted before insert. Decryption
		// is limited to profile display, booking prefill, and compliance paths.
		firstNameEncrypted: bytea("first_name_encrypted"),
		lastNameEncrypted: bytea("last_name_encrypted"),
		dateOfBirthEncrypted: bytea("date_of_birth_encrypted"),
		documentTypeEncrypted: bytea("document_type_encrypted"),
		documentIssuingCountryEncrypted: bytea(
			"document_issuing_country_encrypted",
		),
		documentNumberEncrypted: bytea("document_number_encrypted"),
		documentExpiresOnEncrypted: bytea("document_expires_on_encrypted"),
		nationalityEncrypted: bytea("nationality_encrypted"),
		submittedAt: timestampWithTimezone("submitted_at"),
		verifiedAt: timestampWithTimezone("verified_at"),
		purgeAfter: timestampWithTimezone("purge_after"),
		purgedAt: timestampWithTimezone("purged_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("user_identity_documents_user_status_idx").on(
			table.userId,
			table.status,
		),
		index("user_identity_documents_purge_after_idx").on(table.purgeAfter),
		uniqueIndex("user_identity_documents_active_verified_uidx")
			.on(table.userId)
			.where(sql`${table.status} = 'verified' and ${table.purgedAt} is null`),
		uniqueIndex("user_identity_documents_stripe_session_uidx")
			.on(table.stripeVerificationSessionId)
			.where(sql`${table.stripeVerificationSessionId} is not null`),
		check(
			"user_identity_documents_status_check",
			sql`${table.status} in ('processing', 'requires_input', 'verified', 'canceled')`,
		),
		check(
			"user_identity_documents_source_check",
			sql`${table.source} in ('stripe_identity')`,
		),
	],
);

/**
 * Optional guest profile holding the self-service details a user fills in on
 * their account: contact phone, billing identity (company/tax) and address, and
 * residence/nationality. These are the defaults that pre-fill the checkout
 * contact step (see `orderContact`), so the column set mirrors that snapshot.
 */
export const userProfile = pgTable("user_profile", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	phoneE164: text("phone_e164"),
	isCompany: boolean("is_company").notNull().default(false),
	companyName: text("company_name"),
	taxNumber: text("tax_number"),
	billingLine1: text("billing_line1"),
	billingLine2: text("billing_line2"),
	billingCity: text("billing_city"),
	billingRegion: text("billing_region"),
	billingPostalCode: text("billing_postal_code"),
	// ISO 3166-1 alpha-2 country codes.
	billingCountry: text("billing_country"),
	residenceCountry: text("residence_country"),
	nationality: text("nationality"),
	createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
	updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
});

export const providerSyncRun = pgTable(
	"provider_sync_run",
	{
		activitiesCreated: integer("activities_created").notNull().default(0),
		activitiesDisabled: integer("activities_disabled").notNull().default(0),
		activitiesFailed: integer("activities_failed").notNull().default(0),
		activitiesSeen: integer("activities_seen").notNull().default(0),
		activitiesUnchanged: integer("activities_unchanged").notNull().default(0),
		activitiesUpdated: integer("activities_updated").notNull().default(0),
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

export const activityExperience = pgTable(
	"activity_experience",
	{
		id: text("id").primaryKey(),
		active: boolean("active").notNull().default(true),
		city: text("city"),
		country: text("country"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		detail: jsonb("detail").$type<unknown>().notNull(),
		difficulty: text("difficulty"),
		durationBucket: text("duration_bucket"),
		externalAccountId: text("external_account_id").notNull(),
		externalId: text("external_id").notNull(),
		fetchedAt: timestampWithTimezone("fetched_at").notNull(),
		fromPriceAmount: doublePrecision("from_price_amount"),
		fromPriceCurrency: text("from_price_currency"),
		provider: text("provider").notNull(),
		raw: jsonb("raw").$type<unknown>().notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		sourceHash: text("source_hash").notNull(),
		staleAfter: timestampWithTimezone("stale_after").notNull(),
		summary: jsonb("summary").$type<unknown>().notNull(),
		syncRunId: text("sync_run_id").references(() => providerSyncRun.id, {
			onDelete: "set null",
		}),
		title: text("title"),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("activity_experience_provider_external_uidx").on(
			table.provider,
			table.externalAccountId,
			table.externalId,
		),
		index("activity_experience_active_sort_idx").on(
			table.active,
			table.sortOrder,
			table.externalId,
		),
		index("activity_experience_city_idx").on(table.city),
		index("activity_experience_stale_after_idx").on(table.staleAfter),
		index("activity_experience_sync_run_id_idx").on(table.syncRunId),
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
		searchVector: tsvector("search_vector")
			.notNull()
			.generatedAlwaysAs(
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

export type AppSettingValue = boolean | number | string;

export const appSetting = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: jsonb("value").$type<AppSettingValue>().notNull(),
	createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
	updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
});

/**
 * Public property-owner enquiries. These are kept independently from email
 * delivery so a temporary mail-provider failure never loses a lead.
 */
export const propertyOwnerContact = pgTable(
	"property_owner_contacts",
	{
		id: text("id").primaryKey(),
		fullName: text("full_name").notNull(),
		email: text("email").notNull(),
		phoneNumber: text("phone_number").notNull(),
		propertyAddress: text("property_address").notNull(),
		propertyLocation: text("property_location").notNull(),
		propertyCount: integer("property_count").notNull(),
		bedroomCount: integer("bedroom_count").notNull(),
		notificationSentAt: timestampWithTimezone("notification_sent_at"),
		notificationError: text("notification_error"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("property_owner_contacts_created_at_idx").on(table.createdAt),
		index("property_owner_contacts_email_idx").on(table.email),
		check(
			"property_owner_contacts_property_count_check",
			sql`${table.propertyCount} >= 1`,
		),
		check(
			"property_owner_contacts_bedroom_count_check",
			sql`${table.bedroomCount} >= 0`,
		),
	],
);

export const listingHostkitCredential = pgTable(
	"listing_hostkit_credentials",
	{
		listingExternalId: text("listing_external_id").primaryKey(),
		apiKeyEncrypted: bytea("api_key_encrypted").notNull(),
		keyHint: text("key_hint"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [index("listing_hostkit_credentials_hint_idx").on(table.keyHint)],
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
		// Hostify calendar v2 per-day restrictions: closed-to-arrival (no check-in
		// on this day) and closed-to-departure (no checkout on this day).
		cta: boolean("cta"),
		ctd: boolean("ctd"),
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
export type AppliedDiscountSnapshot =
	| {
			source: "stripe";
			couponId: string;
			/** The promotion code the customer entered (null for bare coupon ids). */
			promotionCode: string | null;
			type: "percentage";
			/** 1000 = 10%. */
			percentBasisPoints: number;
			amountMinor: null;
			currency: null;
	  }
	| {
			source: "stripe";
			couponId: string;
			/** The promotion code the customer entered (null for bare coupon ids). */
			promotionCode: string | null;
			type: "fixed";
			percentBasisPoints: null;
			/** In cart currency minor units. */
			amountMinor: number;
			currency: string;
	  };

export const cart = pgTable(
	"carts",
	{
		id: text("id").primaryKey(),
		appliedDiscount: jsonb("applied_discount").$type<AppliedDiscountSnapshot>(),
		cartToken: text("cart_token").notNull(),
		convertedOrderId: text("converted_order_id").references(
			(): AnyPgColumn => order.id,
			{
				onDelete: "set null",
			},
		),
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
		check(
			"carts_status_check",
			sql`${table.status} in ('draft', 'converted', 'expired')`,
		),
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
		check(
			"accommodation_quote_snapshots_validation_status_check",
			sql`${table.validationStatus} in ('valid', 'unavailable', 'provider_error')`,
		),
	],
);

export interface ActivityParticipantSnapshot {
	count: number;
	label: string;
	pricingCategoryId: number;
	subtotalMinor: number;
	unitPriceMinor: number;
}

export interface ActivityBookingAnswerSnapshot {
	answer: string;
	group: string;
	participantIndex: number | null;
	questionId: string;
}

export const activityQuoteSnapshot = pgTable(
	"activity_quote_snapshots",
	{
		id: text("id").primaryKey(),
		activityDate: date("activity_date", { mode: "string" }).notNull(),
		answers: jsonb("answers")
			.$type<ActivityBookingAnswerSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		bokunActivityId: text("bokun_activity_id").notNull(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		expiresAt: timestampWithTimezone("expires_at").notNull(),
		externalAccountId: text("external_account_id").notNull(),
		fetchedAt: timestampWithTimezone("fetched_at").notNull(),
		participants: jsonb("participants")
			.$type<ActivityParticipantSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		provider: text("provider").notNull(),
		providerPayload: jsonb("provider_payload").$type<Record<string, unknown>>(),
		rateId: text("rate_id"),
		startTimeId: text("start_time_id"),
		subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
		taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
		totalParticipants: integer("total_participants").notNull(),
		validationStatus: text("validation_status").notNull().default("valid"),
	},
	(table) => [
		index("activity_quote_snapshots_scope_date_idx").on(
			table.provider,
			table.externalAccountId,
			table.bokunActivityId,
			table.activityDate,
		),
		index("activity_quote_snapshots_expires_at_idx").on(table.expiresAt),
		index("activity_quote_snapshots_validation_status_idx").on(
			table.validationStatus,
		),
		check(
			"activity_quote_snapshots_subtotal_minor_nonneg",
			sql`${table.subtotalMinor} >= 0`,
		),
		check(
			"activity_quote_snapshots_tax_minor_nonneg",
			sql`${table.taxMinor} >= 0`,
		),
		check(
			"activity_quote_snapshots_total_minor_nonneg",
			sql`${table.totalMinor} >= 0`,
		),
		check(
			"activity_quote_snapshots_total_ge_tax",
			sql`${table.totalMinor} >= ${table.taxMinor}`,
		),
		check(
			"activity_quote_snapshots_total_participants_positive",
			sql`${table.totalParticipants} > 0`,
		),
		check(
			"activity_quote_snapshots_validation_status_check",
			sql`${table.validationStatus} in ('valid', 'unavailable', 'expired', 'provider_error')`,
		),
	],
);

export const cartItem = pgTable(
	"cart_items",
	{
		id: text("id").primaryKey(),
		activityQuoteSnapshotId: text("activity_quote_snapshot_id").references(
			() => activityQuoteSnapshot.id,
			{ onDelete: "restrict" },
		),
		cartId: text("cart_id")
			.notNull()
			.references(() => cart.id, { onDelete: "cascade" }),
		clientMutationId: text("client_mutation_id"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		position: integer("position").notNull(),
		quoteSnapshotId: text("quote_snapshot_id").references(
			() => accommodationQuoteSnapshot.id,
			{ onDelete: "restrict" },
		),
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
		check(
			"cart_items_status_check",
			sql`${table.status} in ('active', 'removed')`,
		),
		check(
			"cart_items_type_check",
			sql`${table.type} in ('accommodation', 'activity')`,
		),
		// Exactly one typed quote snapshot per item, matching its type. An
		// accommodation item carries an accommodation snapshot; an activity item
		// carries an activity snapshot; never both, never neither.
		check(
			"cart_items_quote_snapshot_type_check",
			sql`(${table.type} = 'accommodation' and ${table.quoteSnapshotId} is not null and ${table.activityQuoteSnapshotId} is null) or (${table.type} = 'activity' and ${table.activityQuoteSnapshotId} is not null and ${table.quoteSnapshotId} is null)`,
		),
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
		cartId: text("cart_id").references((): AnyPgColumn => cart.id, {
			onDelete: "set null",
		}),
		checkoutExpiresAt: timestampWithTimezone("checkout_expires_at"),
		confirmedAt: timestampWithTimezone("confirmed_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		currency: text("currency").notNull(),
		discountMinor: bigint("discount_minor", { mode: "number" })
			.notNull()
			.default(0),
		failureCode: text("failure_code"),
		failureDetail: text("failure_detail"),
		finalizationEmailAttemptCount: integer("finalization_email_attempt_count")
			.notNull()
			.default(0),
		finalizationEmailKind: text("finalization_email_kind"),
		finalizationEmailLastError: text("finalization_email_last_error"),
		finalizationEmailNextAttemptAt: timestampWithTimezone(
			"finalization_email_next_attempt_at",
		)
			.notNull()
			.defaultNow(),
		finalizationEmailSentAt: timestampWithTimezone(
			"finalization_email_sent_at",
		),
		pendingNoticeEmailNextAttemptAt: timestampWithTimezone(
			"pending_notice_email_next_attempt_at",
		)
			.notNull()
			.defaultNow(),
		pendingNoticeEmailSentAt: timestampWithTimezone(
			"pending_notice_email_sent_at",
		),
		publicReference: text("public_reference").notNull(),
		status: text("status").notNull().default("draft"),
		refundCompletedAt: timestampWithTimezone("refund_completed_at"),
		refundRequestedAt: timestampWithTimezone("refund_requested_at"),
		stripeRefundId: text("stripe_refund_id"),
		stripeRefundIdempotencyKey: text("stripe_refund_idempotency_key"),
		stripePaymentIntentId: text("stripe_payment_intent_id"),
		stripePaymentMethodBrand: text("stripe_payment_method_brand"),
		stripePaymentMethodLast4: text("stripe_payment_method_last4"),
		stripePaymentMethodType: text("stripe_payment_method_type"),
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
		index("orders_finalization_email_pending_idx")
			.on(table.finalizationEmailNextAttemptAt)
			.where(
				sql`${table.finalizationEmailKind} is not null and ${table.finalizationEmailSentAt} is null`,
			),
		uniqueIndex("orders_stripe_payment_intent_id_uidx").on(
			table.stripePaymentIntentId,
		),
		uniqueIndex("orders_stripe_refund_id_uidx")
			.on(table.stripeRefundId)
			.where(sql`${table.stripeRefundId} is not null`),
		uniqueIndex("orders_stripe_refund_idempotency_key_uidx")
			.on(table.stripeRefundIdempotencyKey)
			.where(sql`${table.stripeRefundIdempotencyKey} is not null`),
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
		check(
			"orders_amount_refunded_lte_paid",
			sql`${table.amountRefundedMinor} <= ${table.amountPaidMinor}`,
		),
		check(
			"orders_finalization_email_attempt_count_nonneg",
			sql`${table.finalizationEmailAttemptCount} >= 0`,
		),
		check(
			"orders_finalization_email_kind_check",
			sql`${table.finalizationEmailKind} is null or ${table.finalizationEmailKind} in ('confirmation', 'refund_amount_mismatch', 'refund_unconfirmed')`,
		),
		check(
			"orders_status_check",
			sql`${table.status} in ('draft', 'pending', 'confirmed', 'cancelled', 'failed')`,
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
		// Activity bookings need Bokun's main-contact fields (first/last name, date
		// of birth, language); accommodation-only orders leave them null.
		dateOfBirth: date("date_of_birth", { mode: "string" }),
		email: text("email").notNull(),
		firstName: text("first_name"),
		isCompany: boolean("is_company").notNull().default(false),
		language: text("language"),
		lastName: text("last_name"),
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

export type OrderMemberRole = "owner" | "member";
export type OrderMemberStatus = "invited" | "active" | "revoked";
export type ConversationStatus = "pending" | "active" | "archived";
export type ConversationMessageSenderType = "guest" | "host" | "system";
export type ConversationMessageDeliveryStatus = "pending" | "sent" | "failed";

/**
 * People who can reach an order's hub (`/order/[reference]`). The `owner` is the
 * booker (full access); `member` rows are invited guests. Access is proven by a
 * high-entropy token whose sha-256 hash is stored here — the low-entropy
 * `public_reference` is never sufficient on its own. The partial unique index
 * caps an order at one owner.
 */
export const orderMember = pgTable(
	"order_members",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		role: text("role").$type<OrderMemberRole>().notNull(),
		email: text("email").notNull(),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		accessTokenHash: text("access_token_hash").notNull(),
		status: text("status")
			.$type<OrderMemberStatus>()
			.notNull()
			.default("invited"),
		invitedByMemberId: text("invited_by_member_id").references(
			(): AnyPgColumn => orderMember.id,
			{ onDelete: "set null" },
		),
		expiresAt: timestampWithTimezone("expires_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		acceptedAt: timestampWithTimezone("accepted_at"),
		lastSeenAt: timestampWithTimezone("last_seen_at"),
	},
	(table) => [
		uniqueIndex("order_members_access_token_hash_uidx").on(
			table.accessTokenHash,
		),
		index("order_members_order_id_idx").on(table.orderId),
		index("order_members_user_id_idx")
			.on(table.userId)
			.where(sql`${table.userId} is not null`),
		uniqueIndex("order_members_id_order_id_uidx").on(table.id, table.orderId),
		uniqueIndex("order_members_order_email_uidx")
			.on(table.orderId, sql`lower(${table.email})`)
			.where(sql`${table.status} <> 'revoked'`),
		// At most one live membership per account per order: a signed-in user cannot
		// redeem two invites for the same booking (which would split access
		// resolution and double-count them against capacity). Revoked rows keep their
		// user_id for audit, so they are excluded from the uniqueness rule.
		uniqueIndex("order_members_order_user_uidx")
			.on(table.orderId, table.userId)
			.where(sql`${table.userId} is not null and ${table.status} <> 'revoked'`),
		uniqueIndex("order_members_owner_uidx")
			.on(table.orderId)
			.where(sql`${table.role} = 'owner'`),
		check(
			"order_members_role_check",
			sql`${table.role} in ('owner', 'member')`,
		),
		check(
			"order_members_status_check",
			sql`${table.status} in ('invited', 'active', 'revoked')`,
		),
		check(
			"order_members_owner_expires_null",
			sql`${table.role} = 'member' or ${table.expiresAt} is null`,
		),
		foreignKey({
			columns: [table.invitedByMemberId, table.orderId],
			foreignColumns: [table.id, table.orderId],
			name: "order_members_invited_by_member_order_fk",
		}).onDelete("set null"),
	],
);

export type OrderMember = typeof orderMember.$inferSelect;

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
		uniqueIndex("order_items_id_order_id_uidx").on(table.id, table.orderId),
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
		check(
			"order_items_status_check",
			sql`${table.status} in ('draft', 'pending', 'confirmed', 'cancelled', 'failed')`,
		),
		check(
			"order_items_type_check",
			sql`${table.type} in ('accommodation', 'activity')`,
		),
	],
);

export const providerBooking = pgTable(
	"provider_bookings",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		orderItemId: text("order_item_id")
			.notNull()
			.references(() => orderItem.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		externalAccountId: text("external_account_id"),
		providerReservationId: text("provider_reservation_id"),
		// Hostify financial-record id for the accommodation transaction created with
		// the hold (incomplete) and completed on payment acceptance.
		providerTransactionId: text("provider_transaction_id"),
		providerStatus: text("provider_status"),
		normalizedStatus: text("normalized_status")
			.$type<ProviderBookingStatus>()
			.notNull()
			.default("pending"),
		stayStartsAt: timestampWithTimezone("stay_starts_at"),
		stayEndsAt: timestampWithTimezone("stay_ends_at"),
		providerCreatedAt: timestampWithTimezone("provider_created_at"),
		providerUpdatedAt: timestampWithTimezone("provider_updated_at"),
		rawOperationalPayload: jsonb("raw_operational_payload").$type<
			Record<string, unknown>
		>(),
		// Retry/backoff bookkeeping for the reservation saga. Each hold operation
		// (create/confirm/cancel) is a retryable step the reconciler cron schedules
		// via `nextAttemptAt`; `needsRecovery` is the operator-visible "stuck"
		// signal once attempts are exhausted (until the M7 dashboard exists).
		attemptCount: integer("attempt_count").notNull().default(0),
		lastAttemptAt: timestampWithTimezone("last_attempt_at"),
		nextAttemptAt: timestampWithTimezone("next_attempt_at")
			.defaultNow()
			.notNull(),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		needsRecovery: boolean("needs_recovery").notNull().default(false),
		guestReminderEmailCount: integer("guest_reminder_email_count")
			.notNull()
			.default(0),
		guestReminderEmailLastError: text("guest_reminder_email_last_error"),
		guestReminderEmailLastSentAt: timestampWithTimezone(
			"guest_reminder_email_last_sent_at",
		),
		guestReminderEmailNextAt: timestampWithTimezone(
			"guest_reminder_email_next_at",
		),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("provider_bookings_order_item_uidx").on(table.orderItemId),
		uniqueIndex("provider_bookings_id_order_id_uidx").on(
			table.id,
			table.orderId,
		),
		uniqueIndex("provider_bookings_provider_reservation_uidx")
			.on(table.provider, table.externalAccountId, table.providerReservationId)
			.where(
				sql`${table.providerReservationId} is not null and ${table.externalAccountId} is not null`,
			),
		uniqueIndex("provider_bookings_provider_reservation_null_account_uidx")
			.on(table.provider, table.providerReservationId)
			.where(
				sql`${table.providerReservationId} is not null and ${table.externalAccountId} is null`,
			),
		uniqueIndex("provider_bookings_provider_transaction_uidx")
			.on(table.provider, table.externalAccountId, table.providerTransactionId)
			.where(
				sql`${table.providerTransactionId} is not null and ${table.externalAccountId} is not null`,
			),
		uniqueIndex("provider_bookings_provider_transaction_null_account_uidx")
			.on(table.provider, table.providerTransactionId)
			.where(
				sql`${table.providerTransactionId} is not null and ${table.externalAccountId} is null`,
			),
		index("provider_bookings_provider_date_idx").on(
			table.provider,
			table.stayStartsAt,
			table.stayEndsAt,
		),
		index("provider_bookings_status_idx").on(table.normalizedStatus),
		// Reconciler scan: pending holds whose next attempt is due.
		index("provider_bookings_pending_next_attempt_idx")
			.on(table.nextAttemptAt)
			.where(sql`${table.normalizedStatus} = 'pending'`),
		index("provider_bookings_guest_reminder_due_idx")
			.on(table.guestReminderEmailNextAt)
			.where(sql`${table.guestReminderEmailNextAt} is not null`),
		check(
			"provider_bookings_status_check",
			sql`${table.normalizedStatus} in ('pending', 'confirmed', 'cancelled', 'failed', 'completed')`,
		),
		check(
			"provider_bookings_attempt_count_nonneg",
			sql`${table.attemptCount} >= 0`,
		),
		check(
			"provider_bookings_guest_reminder_count_nonneg",
			sql`${table.guestReminderEmailCount} >= 0`,
		),
		foreignKey({
			columns: [table.orderItemId, table.orderId],
			foreignColumns: [orderItem.id, orderItem.orderId],
			name: "provider_bookings_order_item_order_fk",
		}).onDelete("cascade"),
	],
);

export type ProviderBooking = typeof providerBooking.$inferSelect;

export const conversation = pgTable(
	"conversations",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		providerBookingId: text("provider_booking_id").references(
			() => providerBooking.id,
			{ onDelete: "set null" },
		),
		provider: text("provider").notNull(),
		externalThreadId: text("external_thread_id"),
		status: text("status")
			.$type<ConversationStatus>()
			.notNull()
			.default("pending"),
		lastMessageAt: timestampWithTimezone("last_message_at"),
		lastMessagePreview: text("last_message_preview"),
		unreadCount: integer("unread_count").notNull().default(0),
		lastSyncedAt: timestampWithTimezone("last_synced_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("conversations_order_id_idx").on(table.orderId),
		uniqueIndex("conversations_id_order_id_uidx").on(table.id, table.orderId),
		uniqueIndex("conversations_provider_booking_uidx")
			.on(table.providerBookingId)
			.where(sql`${table.providerBookingId} is not null`),
		uniqueIndex("conversations_provider_thread_uidx")
			.on(table.provider, table.externalThreadId)
			.where(sql`${table.externalThreadId} is not null`),
		// One order-level internal conversation per order; provider-backed rows
		// are keyed per booking/thread instead.
		uniqueIndex("conversations_internal_order_uidx")
			.on(table.orderId)
			.where(sql`${table.provider} = 'internal'`),
		index("conversations_active_sync_idx")
			.on(table.lastSyncedAt)
			.where(
				sql`${table.status} = 'active' and ${table.externalThreadId} is not null`,
			),
		check(
			"conversations_status_check",
			sql`${table.status} in ('pending', 'active', 'archived')`,
		),
		check("conversations_unread_count_nonneg", sql`${table.unreadCount} >= 0`),
		foreignKey({
			columns: [table.providerBookingId, table.orderId],
			foreignColumns: [providerBooking.id, providerBooking.orderId],
			name: "conversations_provider_booking_order_fk",
		}).onDelete("set null"),
	],
);

export type Conversation = typeof conversation.$inferSelect;

export const conversationMessage = pgTable(
	"messages",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		externalMessageId: text("external_message_id"),
		senderType: text("sender_type")
			.$type<ConversationMessageSenderType>()
			.notNull(),
		senderMemberId: text("sender_member_id").references(() => orderMember.id, {
			onDelete: "set null",
		}),
		body: text("body").notNull(),
		sentAt: timestampWithTimezone("sent_at").notNull(),
		readAt: timestampWithTimezone("read_at"),
		isAutomatic: boolean("is_automatic").notNull().default(false),
		deliveryStatus: text("delivery_status")
			.$type<ConversationMessageDeliveryStatus>()
			.notNull()
			.default("pending"),
		rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("messages_conversation_sent_idx").on(
			table.conversationId,
			table.sentAt,
		),
		index("messages_order_id_idx").on(table.orderId),
		index("messages_sender_member_idx")
			.on(table.senderMemberId)
			.where(sql`${table.senderMemberId} is not null`),
		uniqueIndex("messages_conversation_external_uidx")
			.on(table.conversationId, table.externalMessageId)
			.where(sql`${table.externalMessageId} is not null`),
		check(
			"messages_sender_type_check",
			sql`${table.senderType} in ('guest', 'host', 'system')`,
		),
		check(
			"messages_delivery_status_check",
			sql`${table.deliveryStatus} in ('pending', 'sent', 'failed')`,
		),
		check("messages_body_not_empty", sql`length(trim(${table.body})) > 0`),
		foreignKey({
			columns: [table.conversationId, table.orderId],
			foreignColumns: [conversation.id, conversation.orderId],
			name: "messages_conversation_order_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.senderMemberId, table.orderId],
			foreignColumns: [orderMember.id, orderMember.orderId],
			name: "messages_sender_member_order_fk",
		}).onDelete("set null"),
	],
);

export type ConversationMessage = typeof conversationMessage.$inferSelect;

export const bookingGuest = pgTable(
	"booking_guests",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		providerBookingId: text("provider_booking_id")
			.notNull()
			.references(() => providerBooking.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		userIdentityDocumentId: text("user_identity_document_id").references(
			() => userIdentityDocument.id,
			{ onDelete: "set null" },
		),
		orderMemberId: text("order_member_id").references(() => orderMember.id, {
			onDelete: "set null",
		}),
		position: integer("position").notNull(),
		identityStatus: text("identity_status")
			.$type<BookingGuestIdentityStatus>()
			.notNull()
			.default("missing"),
		stripeVerificationSessionId: text("stripe_verification_session_id"),
		stripeVerificationReportId: text("stripe_verification_report_id"),
		// Encrypted snapshot columns are independent legal booking records.
		// Encrypt before insert; do not reference live account identity values.
		firstNameEncrypted: bytea("first_name_encrypted"),
		lastNameEncrypted: bytea("last_name_encrypted"),
		dateOfBirthEncrypted: bytea("date_of_birth_encrypted"),
		residenceCountryEncrypted: bytea("residence_country_encrypted"),
		nationalityEncrypted: bytea("nationality_encrypted"),
		documentTypeEncrypted: bytea("document_type_encrypted"),
		documentIssuingCountryEncrypted: bytea(
			"document_issuing_country_encrypted",
		),
		documentNumberEncrypted: bytea("document_number_encrypted"),
		documentExpiresOnEncrypted: bytea("document_expires_on_encrypted"),
		submittedAt: timestampWithTimezone("submitted_at"),
		purgeAfter: timestampWithTimezone("purge_after"),
		purgedAt: timestampWithTimezone("purged_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("booking_guests_booking_position_uidx").on(
			table.providerBookingId,
			table.position,
		),
		uniqueIndex("booking_guests_stripe_session_uidx")
			.on(table.stripeVerificationSessionId)
			.where(sql`${table.stripeVerificationSessionId} is not null`),
		index("booking_guests_provider_booking_idx").on(table.providerBookingId),
		index("booking_guests_order_id_idx").on(table.orderId),
		index("booking_guests_user_idx").on(table.userId),
		index("booking_guests_order_member_idx")
			.on(table.orderMemberId)
			.where(sql`${table.orderMemberId} is not null`),
		index("booking_guests_identity_document_idx").on(
			table.userIdentityDocumentId,
		),
		index("booking_guests_purge_after_idx").on(table.purgeAfter),
		uniqueIndex("booking_guests_booking_member_uidx")
			.on(table.providerBookingId, table.orderMemberId)
			.where(sql`${table.orderMemberId} is not null`),
		check("booking_guests_position_nonneg", sql`${table.position} >= 0`),
		check(
			"booking_guests_identity_status_check",
			sql`${table.identityStatus} in ('missing', 'provided', 'processing', 'requires_input', 'verified', 'canceled')`,
		),
		foreignKey({
			columns: [table.providerBookingId, table.orderId],
			foreignColumns: [providerBooking.id, providerBooking.orderId],
			name: "booking_guests_provider_booking_order_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.orderMemberId, table.orderId],
			foreignColumns: [orderMember.id, orderMember.orderId],
			name: "booking_guests_order_member_order_fk",
		}).onDelete("set null"),
	],
);

export const guestSubmissionJob = pgTable(
	"guest_submission_jobs",
	{
		id: text("id").primaryKey(),
		providerBookingId: text("provider_booking_id")
			.notNull()
			.references(() => providerBooking.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<GuestSubmissionJobStatus>()
			.notNull()
			.default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(5),
		nextRunAt: timestampWithTimezone("next_run_at"),
		startedAt: timestampWithTimezone("started_at"),
		completedAt: timestampWithTimezone("completed_at"),
		redactedErrorText: text("redacted_error_text"),
		externalResultReference: text("external_result_reference"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("guest_submission_jobs_booking_status_idx").on(
			table.providerBookingId,
			table.status,
		),
		uniqueIndex("guest_submission_jobs_active_booking_uidx")
			.on(table.providerBookingId)
			.where(sql`${table.status} in ('pending', 'running', 'retrying')`),
		index("guest_submission_jobs_status_next_run_idx").on(
			table.status,
			table.nextRunAt,
		),
		check(
			"guest_submission_jobs_status_check",
			sql`${table.status} in ('pending', 'running', 'retrying', 'succeeded', 'failed', 'canceled')`,
		),
		check(
			"guest_submission_jobs_attempt_count_nonneg",
			sql`${table.attemptCount} >= 0`,
		),
		check(
			"guest_submission_jobs_max_attempts_nonneg",
			sql`${table.maxAttempts} >= 0`,
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

export const activityItemDetail = pgTable(
	"activity_item_details",
	{
		orderItemId: text("order_item_id")
			.primaryKey()
			.references(() => orderItem.id, { onDelete: "cascade" }),
		activityDate: date("activity_date", { mode: "string" }).notNull(),
		answers: jsonb("answers")
			.$type<ActivityBookingAnswerSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		bokunActivityId: text("bokun_activity_id").notNull(),
		// Resolved Bokun pickup/dropoff place ids; set when the rate requires them.
		dropoffPlaceId: text("dropoff_place_id"),
		externalAccountId: text("external_account_id").notNull(),
		participants: jsonb("participants")
			.$type<ActivityParticipantSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		pickupPlaceId: text("pickup_place_id"),
		provider: text("provider").notNull(),
		rateId: text("rate_id"),
		roomNumber: text("room_number"),
		startTimeId: text("start_time_id"),
		totalParticipants: integer("total_participants").notNull(),
	},
	(table) => [
		index("activity_item_details_activity_idx").on(
			table.provider,
			table.externalAccountId,
			table.bokunActivityId,
			table.activityDate,
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
		check(
			"order_item_charges_kind_check",
			sql`${table.kind} in ('accommodation', 'activity', 'tax', 'discount', 'fee')`,
		),
		check(
			"order_item_charges_signed_amounts_check",
			sql`(
				${table.kind} = 'discount'
				and ${table.grossMinor} <= 0
				and ${table.netMinor} <= 0
				and ${table.unitNetMinor} <= 0
			) or (
				${table.kind} <> 'discount'
				and ${table.grossMinor} >= 0
				and ${table.netMinor} >= 0
				and ${table.unitNetMinor} >= 0
			)`,
		),
	],
);

export type OrderInvoiceKind = "credit_note" | "invoice";
export type OrderInvoiceStatus = "draft" | "failed" | "issued";

/**
 * Fiscal documents (invoices / credit notes) issued through Hostkit against
 * one order item. The Hostkit invoicing account is property-scoped, so a
 * multi-stay order carries one invoice per item, never one per order. The row
 * is created as `draft` before any provider call (the partial unique index is
 * the double-issuance guard), promoted to `issued` once Hostkit closes the
 * document, or parked at `failed` with a redacted error for operator review.
 */
export const orderInvoice = pgTable(
	"order_invoices",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		orderItemId: text("order_item_id")
			.notNull()
			.references(() => orderItem.id, { onDelete: "cascade" }),
		kind: text("kind").$type<OrderInvoiceKind>().notNull().default("invoice"),
		status: text("status")
			.$type<OrderInvoiceStatus>()
			.notNull()
			.default("draft"),
		// Credit notes reference the local invoice row they void.
		refInvoiceId: text("ref_invoice_id").references(
			(): AnyPgColumn => orderInvoice.id,
			{ onDelete: "set null" },
		),
		// Hostkit identifiers: document id within a series of an invoicing NIF.
		hostkitInvoiceId: text("hostkit_invoice_id"),
		hostkitSeries: text("hostkit_series"),
		invoicingNif: text("invoicing_nif"),
		// Provider reservation code the document was attached to.
		reservationCode: text("reservation_code"),
		documentUrl: text("document_url"),
		currency: text("currency").notNull(),
		totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
		lastErrorMessage: text("last_error_message"),
		issuedAt: timestampWithTimezone("issued_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("order_invoices_order_idx").on(table.orderId),
		index("order_invoices_order_item_idx").on(table.orderItemId),
		index("order_invoices_ref_invoice_idx").on(table.refInvoiceId),
		// One live (draft or issued) invoice per order item; failed rows do not
		// block a retry, credit notes are unlimited.
		uniqueIndex("order_invoices_active_invoice_uidx")
			.on(table.orderItemId)
			.where(
				sql`${table.kind} = 'invoice' and ${table.status} in ('draft', 'issued')`,
			),
		check(
			"order_invoices_kind_check",
			sql`${table.kind} in ('credit_note', 'invoice')`,
		),
		check(
			"order_invoices_status_check",
			sql`${table.status} in ('draft', 'failed', 'issued')`,
		),
		foreignKey({
			columns: [table.orderItemId, table.orderId],
			foreignColumns: [orderItem.id, orderItem.orderId],
			name: "order_invoices_order_item_order_fk",
		}).onDelete("cascade"),
	],
);

export type OrderInvoice = typeof orderInvoice.$inferSelect;

export type OrderRefundStatus = "failed" | "pending" | "succeeded";
export type OrderRefundReason =
	| "duplicate"
	| "fraudulent"
	| "other"
	| "requested_by_customer";

/**
 * Ledger of manual, operator-issued refunds against an order's Stripe
 * PaymentIntent. `orders.amount_refunded_minor` stays the authoritative
 * aggregate (the `<= amount_paid` guard lives on the order row); each row here
 * records one Stripe refund so a multi-refund order is fully reconstructable.
 * `order_item_id` optionally attributes a refund to one reservation for
 * reporting, but the money always moves against the single order PaymentIntent.
 * A row is written `pending` before the Stripe call, promoted to `succeeded`
 * with the refund id once Stripe accepts it, or parked `failed` with a redacted
 * error. The automatic full-refund compensation path does not write here; it
 * keeps using the single `orders.stripe_refund_*` columns.
 */
export const orderRefund = pgTable(
	"order_refunds",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		orderItemId: text("order_item_id").references(() => orderItem.id, {
			onDelete: "set null",
		}),
		amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
		currency: text("currency").notNull(),
		reason: text("reason")
			.$type<OrderRefundReason>()
			.notNull()
			.default("requested_by_customer"),
		note: text("note"),
		status: text("status")
			.$type<OrderRefundStatus>()
			.notNull()
			.default("pending"),
		stripeRefundId: text("stripe_refund_id"),
		stripeRefundIdempotencyKey: text("stripe_refund_idempotency_key").notNull(),
		// Explicit Detours transfer reversal issued alongside the refund; null for
		// accommodation-only refunds and refunds recorded before reversals existed.
		stripeTransferReversalId: text("stripe_transfer_reversal_id"),
		transferReversalAmountMinor: bigint("transfer_reversal_amount_minor", {
			mode: "number",
		}),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		lastErrorMessage: text("last_error_message"),
		completedAt: timestampWithTimezone("completed_at"),
		createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("order_refunds_order_idx").on(table.orderId),
		index("order_refunds_order_item_idx").on(table.orderItemId),
		uniqueIndex("order_refunds_idempotency_key_uidx").on(
			table.stripeRefundIdempotencyKey,
		),
		uniqueIndex("order_refunds_stripe_refund_id_uidx")
			.on(table.stripeRefundId)
			.where(sql`${table.stripeRefundId} is not null`),
		check("order_refunds_amount_minor_positive", sql`${table.amountMinor} > 0`),
		check(
			"order_refunds_reason_check",
			sql`${table.reason} in ('requested_by_customer', 'duplicate', 'fraudulent', 'other')`,
		),
		check(
			"order_refunds_status_check",
			sql`${table.status} in ('pending', 'succeeded', 'failed')`,
		),
	],
);

export type OrderRefund = typeof orderRefund.$inferSelect;

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
		check(
			"api_idempotency_keys_status_check",
			sql`${table.status} in ('in_progress', 'completed', 'failed')`,
		),
		index("api_idempotency_keys_expires_at_idx").on(table.expiresAt),
	],
);

export const schema = {
	user,
	session,
	account,
	verification,
	userIdentityDocument,
	userProfile,
	providerSyncRun,
	providerSyncState,
	activityExperience,
	accommodationListing,
	appSetting,
	propertyOwnerContact,
	accommodationListingNight,
	observabilityEvent,
	listingReview,
	listingReviewSummary,
	listingHostkitCredential,
	cart,
	cartItem,
	accommodationQuoteSnapshot,
	order,
	orderContact,
	orderItem,
	providerBooking,
	conversation,
	conversationMessage,
	bookingGuest,
	guestSubmissionJob,
	accommodationItemDetail,
	orderItemCharge,
	orderInvoice,
	apiIdempotencyKey,
};
