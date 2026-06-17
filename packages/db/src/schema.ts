import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export interface ListingSectionHashes {
	amenities: string;
	description: string;
	fees: string;
	guide: string;
	location: string;
	photos: string;
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
	fees: unknown;
	guestGuide: unknown;
	listing: unknown;
	photos: unknown;
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

export const accommodationListing = pgTable(
	"accommodation_listing",
	{
		id: text("id").primaryKey(),
		active: boolean("active").notNull().default(true),
		bathrooms: doublePrecision("bathrooms"),
		bedrooms: doublePrecision("bedrooms"),
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
	],
);

export const schema = {
	user,
	session,
	account,
	verification,
	providerSyncRun,
	accommodationListing,
};
