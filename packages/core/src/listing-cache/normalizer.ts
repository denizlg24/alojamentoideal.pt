import type {
	AccommodationListingNormalizedContent,
	AccommodationListingRawContent,
	ListingSectionHashes,
	LocalizedText,
	ProcessedAmenity,
} from "@workspace/db";
import { hostifyPropertyTypeLabel } from "../hostify-property-types";
import { HOSTIFY_AMENITY_CATALOG } from "./amenity-catalog";
import { publicAmenityGroupForInput } from "./amenity-groups";
import { AMENITY_ICON_SET, pickAmenityIcon } from "./amenity-icons";
import { sanitizeProviderPayload } from "./hash";
import {
	LISTING_DESCRIPTION_SECTIONS,
	type LocalizedDescriptionSections,
} from "./localization";
import { versionedHash } from "./sync-version";

export interface HostifyListingSections {
	/**
	 * Listing amenities as returned by the detail endpoint's
	 * `include_related_objects` sibling array (each `{ id, name, ... }`). Lives
	 * alongside `listing`, not inside it.
	 */
	amenities: unknown;
	/**
	 * Rich description sibling (`{ description, name, house_rules, ... }`). The
	 * `listing` object itself has no usable description, so this is the source of
	 * the listing's prose.
	 */
	description: unknown;
	/** Structured facts sibling (`{ floor, area, wireless_ssid, ... }`). */
	details: unknown;
	fees: unknown;
	guestGuide: unknown;
	listing: unknown;
	photos: unknown;
	/** Per-room breakdown sibling (`{ name, room_type, beds[], ... }`). */
	rooms: unknown;
	status: unknown;
	translations: unknown;
}

export interface NormalizedAmenityInput {
	id: string | null;
	sourceLabel: string;
}

export interface ListingCacheProjection {
	active: boolean;
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	city: string | null;
	country: string | null;
	description: string | null;
	externalId: string;
	latitude: number | null;
	longitude: number | null;
	name: string | null;
	nickname: string | null;
	normalized: AccommodationListingNormalizedContent;
	personCapacity: number | null;
	processedFallback: {
		amenities: ProcessedAmenity[];
		description: LocalizedText;
		descriptionSections: LocalizedDescriptionSections;
		guide: LocalizedText;
		model: null;
		title: LocalizedText;
	};
	propertyType: string | null;
	providerUpdatedAt: Date | null;
	raw: AccommodationListingRawContent;
	sectionHashes: ListingSectionHashes;
	sourceHash: string;
	timezone: string | null;
}

export function buildListingCacheProjection(
	sections: HostifyListingSections,
): ListingCacheProjection {
	const raw = sanitizeSections(sections);
	const listing = asRecord(raw.listing);
	const translations = asArray(raw.translations);
	const amenities = extractAmenities(listing, sections.amenities);
	const descriptionContent = asRecord(raw.description);
	const title = readString(listing, "name") ?? readString(listing, "nickname");
	// Hostify keeps public listing prose in the `description` sibling. `summary`
	// is the clean lead paragraph; `description` often repeats it plus notes.
	const description = pickDescriptionLead(
		descriptionContent,
		listing,
		translations,
	);
	const descriptionSections =
		extractDescriptionSectionSources(descriptionContent);
	// Hostify's dedicated `guest_guide` endpoint is unpopulated on this account;
	// the real house-guide content lives as optional fields on the `description`
	// sibling (house rules, directions, notes/parking) plus the check-in schedule
	// on `listing`. Assemble those into the guest-facing guide.
	const guideText = buildHouseGuide(descriptionContent, listing);

	const normalized: AccommodationListingNormalizedContent = {
		amenities,
		description,
		descriptionSections,
		guide: guideText,
		listing,
		title,
		translations,
	};

	const sectionHashes: ListingSectionHashes = {
		amenities: versionedHash(amenities),
		description: versionedHash({ description, raw: raw.description }),
		details: versionedHash(raw.details),
		fees: versionedHash(raw.fees),
		guide: versionedHash(guideText),
		location: versionedHash({
			address: readString(listing, "address"),
			city: readString(listing, "city"),
			country: readString(listing, "country"),
			latitude: readNumberFrom(listing, ["lat", "latitude"]),
			longitude: readNumberFrom(listing, ["lng", "longitude"]),
			state: readString(listing, "state"),
			timezone: readString(listing, "timezone"),
			zipcode: readScalarString(listing, "zipcode"),
		}),
		photos: versionedHash(raw.photos),
		rooms: versionedHash(raw.rooms),
		status: versionedHash(raw.status),
		title: versionedHash({
			name: readString(listing, "name"),
			nickname: readString(listing, "nickname"),
		}),
		translations: versionedHash(translations),
	};

	return {
		active: listingActive(listing, raw.status),
		bathrooms: readNumber(listing, "bathrooms"),
		bedrooms: readNumber(listing, "bedrooms"),
		beds: readNumber(listing, "beds"),
		city: readString(listing, "city"),
		country: readString(listing, "country"),
		description,
		externalId: readRequiredId(listing),
		latitude: readNumberFrom(listing, ["lat", "latitude"]),
		longitude: readNumberFrom(listing, ["lng", "longitude"]),
		name: readString(listing, "name"),
		nickname: readString(listing, "nickname"),
		normalized,
		personCapacity: readNumber(listing, "person_capacity"),
		processedFallback: {
			amenities: toProcessedAmenities(amenities),
			description: localizedDescriptionFallback(description, translations),
			descriptionSections: localizedDescriptionSectionsFallback(
				descriptionSections,
				translations,
			),
			guide: repeatLocalized(guideText),
			model: null,
			title: repeatLocalized(title),
		},
		propertyType:
			readScalarString(listing, "property_type") ??
			hostifyPropertyTypeLabel(readScalarString(listing, "property_type_id")),
		providerUpdatedAt: readDate(listing, [
			"updated_at",
			"updatedAt",
			"modified_at",
			"modifiedAt",
		]),
		raw,
		sectionHashes,
		sourceHash: versionedHash(raw),
		timezone: readString(listing, "timezone"),
	};
}

function listingActive(
	listing: Record<string, unknown>,
	status: unknown,
): boolean {
	const isListed = readBoolean(listing, "is_listed");
	if (isListed !== null) {
		return isListed;
	}

	const listedStatus = readListedStatus(status);
	if (listedStatus !== null) {
		return listedStatus;
	}

	return readBoolean(listing, "active") ?? true;
}

function readListedStatus(value: unknown): boolean | null {
	if (typeof value === "string") {
		return listedStatusFromString(value);
	}

	if (!isRecord(value)) {
		return null;
	}

	return (
		readBoolean(value, "is_listed") ??
		listedStatusFromString(
			readString(value, "listing_status") ?? readString(value, "status") ?? "",
		)
	);
}

function pickDescriptionLead(
	description: Record<string, unknown>,
	listing: Record<string, unknown>,
	translations: unknown[],
): string | null {
	return (
		readDescriptionText(description) ??
		readTranslatedDescription(translations, "en") ??
		readAnyTranslatedDescription(translations) ??
		readString(listing, "description")
	);
}

function localizedDescriptionFallback(
	fallback: string | null,
	translations: unknown[],
): LocalizedText {
	const localized = repeatLocalized(fallback);

	for (const locale of ["en", "es", "pt"] as const) {
		localized[locale] =
			readTranslatedDescription(translations, locale) ?? localized[locale];
	}

	return localized;
}

function localizedDescriptionSectionsFallback(
	sections: Record<string, string>,
	translations: unknown[],
): LocalizedDescriptionSections {
	return Object.fromEntries(
		LISTING_DESCRIPTION_SECTIONS.map(({ key }) => {
			const localized = repeatLocalized(sections[key]);
			for (const locale of ["en", "es", "pt"] as const) {
				localized[locale] =
					readTranslatedDescriptionField(translations, locale, key) ??
					localized[locale];
			}
			return [key, localized];
		}),
	) as LocalizedDescriptionSections;
}

function extractDescriptionSectionSources(
	description: Record<string, unknown>,
): Record<string, string> {
	return Object.fromEntries(
		LISTING_DESCRIPTION_SECTIONS.map(({ key }) => [
			key,
			readDescriptionSectionField(description, key) ?? "",
		]),
	);
}

function readDescriptionSectionField(
	record: Record<string, unknown>,
	key: string,
): string | null {
	return (
		flattenGuideText(record[key]) ?? flattenGuideText(record[`${key}_rtf`])
	);
}

function readDescriptionText(record: Record<string, unknown>): string | null {
	return (
		readString(record, "summary") ??
		readString(record, "description") ??
		readString(record, "space")
	);
}

function readTranslatedDescription(
	translations: unknown[],
	locale: keyof LocalizedText,
): string | null {
	for (const translation of translations) {
		if (!isRecord(translation)) {
			continue;
		}

		const language = readString(translation, "language");
		if (normalizeLanguage(language) !== locale) {
			continue;
		}

		const text = readDescriptionText(translation);
		if (text) {
			return text;
		}
	}

	return null;
}

function readTranslatedDescriptionField(
	translations: unknown[],
	locale: keyof LocalizedText,
	key: string,
): string | null {
	for (const translation of translations) {
		if (!isRecord(translation)) {
			continue;
		}

		const language = readString(translation, "language");
		if (normalizeLanguage(language) !== locale) {
			continue;
		}

		const text = readDescriptionSectionField(translation, key);
		if (text) {
			return text;
		}
	}

	return null;
}

function readAnyTranslatedDescription(translations: unknown[]): string | null {
	for (const translation of translations) {
		if (!isRecord(translation)) {
			continue;
		}

		const text = readDescriptionText(translation);
		if (text) {
			return text;
		}
	}

	return null;
}

function normalizeLanguage(value: string | null): string | null {
	return value?.toLowerCase().split(/[-_]/)[0] ?? null;
}

function listedStatusFromString(value: string): boolean | null {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (!normalized) {
		return null;
	}

	if (
		[
			"archived",
			"disabled",
			"draft",
			"hidden",
			"inactive",
			"not_listed",
			"suspended",
			"unlisted",
			"unpublished",
		].includes(normalized)
	) {
		return false;
	}

	if (["listed", "live", "published"].includes(normalized)) {
		return true;
	}

	return null;
}

export function amenityInputs(
	normalized: AccommodationListingNormalizedContent,
): NormalizedAmenityInput[] {
	return extractAmenityInputs(normalized.amenities);
}

export function guideToText(value: unknown): string | null {
	if (typeof value === "string") {
		return cleanString(value);
	}

	if (!isRecord(value)) {
		return null;
	}

	const lines = Object.entries(value)
		.filter(([key]) => key !== "success")
		.flatMap(([key, nested]) => guideLines(key, nested));

	return cleanString(lines.join("\n"));
}

/**
 * The optional `description`-sibling fields that make up the guest-facing house
 * guide, in render order. Sensitive fields (`checkin_instructions` door codes,
 * landlord contact, payment details) are intentionally left out.
 */
const GUIDE_DESCRIPTION_SECTIONS: readonly { key: string; label: string }[] = [
	{ key: "directions", label: "Getting there" },
	{ key: "house_rules", label: "House rules" },
	{ key: "house_manual", label: "House manual" },
	{ key: "notes", label: "Good to know" },
];

/**
 * Assembles the guest-facing "house guide" from the optional practical fields
 * Hostify keeps on the `description` sibling (`house_rules`, `directions`,
 * `notes`/parking, ...) plus the check-in schedule on the `listing` object. Each
 * section is optional, so empty fields are dropped and the guide only ever
 * contains real content; returns `null` when nothing is available.
 */
export function buildHouseGuide(
	description: Record<string, unknown>,
	listing: Record<string, unknown>,
): string | null {
	const sections: string[] = [];

	const schedule = buildScheduleSection(listing);
	if (schedule) {
		sections.push(schedule);
	}

	for (const { key, label } of GUIDE_DESCRIPTION_SECTIONS) {
		const body = readGuideField(description, key);
		if (body) {
			sections.push(`${label}\n${body}`);
		}
	}

	return sections.length > 0 ? sections.join("\n\n") : null;
}

/** Reads a guide field, preferring the plain value and falling back to `_rtf`. */
function readGuideField(
	record: Record<string, unknown>,
	key: string,
): string | null {
	return (
		flattenGuideText(record[key]) ?? flattenGuideText(record[`${key}_rtf`])
	);
}

/** Flattens a guide value (string, list, or nested object) to readable text. */
function flattenGuideText(value: unknown): string | null {
	if (typeof value === "string") {
		return cleanString(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		const parts = value
			.map(flattenGuideText)
			.filter((part): part is string => part !== null);
		return parts.length > 0 ? parts.join("\n") : null;
	}

	if (isRecord(value)) {
		const parts = Object.entries(value)
			.filter(([nestedKey]) => nestedKey !== "success")
			.map(([, nested]) => flattenGuideText(nested))
			.filter((part): part is string => part !== null);
		return parts.length > 0 ? parts.join("\n") : null;
	}

	return null;
}

/** Check-in/check-out times and quiet hours, drawn from `listing` clock fields. */
function buildScheduleSection(listing: Record<string, unknown>): string | null {
	const lines: string[] = [];

	const checkIn = formatCheckIn(
		readTime(listing, "checkin_start"),
		readTime(listing, "checkin_end"),
	);
	if (checkIn) {
		lines.push(checkIn);
	}

	const checkout = readTime(listing, "checkout");
	if (checkout) {
		lines.push(`Check-out: until ${checkout}`);
	}

	const quietHours = formatTimeRange(
		readTime(listing, "quiet_hours_from"),
		readTime(listing, "quiet_hours_to"),
	);
	if (quietHours) {
		lines.push(`Quiet hours: ${quietHours}`);
	}

	return lines.length > 0
		? `Check-in and check-out\n${lines.join("\n")}`
		: null;
}

/** Normalizes a Hostify `HH:MM:SS` clock string to `HH:MM`. */
function readTime(
	listing: Record<string, unknown>,
	key: string,
): string | null {
	const raw = readScalarString(listing, key);
	if (!raw) {
		return null;
	}

	const match = raw.match(/^(\d{1,2}):(\d{2})/);
	if (!match) {
		return raw;
	}

	const [, hours = "", minutes = ""] = match;
	return `${hours.padStart(2, "0")}:${minutes}`;
}

function formatCheckIn(
	start: string | null,
	end: string | null,
): string | null {
	if (!start) {
		return null;
	}

	// Hostify uses `00:00` as the "no end" sentinel: check in any time after start.
	return end && end !== "00:00" && end !== start
		? `Check-in: ${start} to ${end}`
		: `Check-in: from ${start}`;
}

function formatTimeRange(
	from: string | null,
	to: string | null,
): string | null {
	// `00:00`-`00:00` is Hostify's "not configured" sentinel (e.g. quiet hours).
	if (!from || !to || from === to || (from === "00:00" && to === "00:00")) {
		return null;
	}

	return `${from} to ${to}`;
}

export function repeatLocalized(
	value: string | null | undefined,
): LocalizedText {
	const text = value?.trim() ?? "";

	return {
		en: text,
		es: text,
		pt: text,
	};
}

function sanitizeSections(
	sections: HostifyListingSections,
): AccommodationListingRawContent {
	return {
		description: sanitizeProviderPayload(sections.description),
		details: sanitizeProviderPayload(sections.details),
		fees: sanitizeProviderPayload(sections.fees),
		guestGuide: sanitizeProviderPayload(sections.guestGuide),
		listing: sanitizeProviderPayload(sections.listing),
		photos: sanitizeProviderPayload(sections.photos),
		rooms: sanitizeProviderPayload(sections.rooms),
		status: sanitizeProviderPayload(sections.status),
		translations: sanitizeProviderPayload(sections.translations),
	};
}

/**
 * Resolves each listing amenity to its public icon and label. Equivalent
 * Hostify amenities collapse into one public key first, then known Hostify ids
 * use the static catalog. Unknown ids fall back to the keyword heuristic over
 * the provider's source label.
 */
function toProcessedAmenities(amenities: unknown[]): ProcessedAmenity[] {
	const processed: ProcessedAmenity[] = [];
	const seen = new Set<string>();

	for (const amenity of extractAmenityInputs(amenities)) {
		const group = publicAmenityGroupForInput(amenity);
		const entry =
			group ?? (amenity.id ? HOSTIFY_AMENITY_CATALOG[amenity.id] : undefined);
		const id = group?.key ?? amenity.id;
		const label = entry?.label ?? amenity.sourceLabel;
		const dedupeKey = amenityDedupeKey(id, label);

		if (seen.has(dedupeKey)) {
			continue;
		}
		seen.add(dedupeKey);

		processed.push({
			icon: {
				name: entry?.icon ?? pickAmenityIcon(amenity.sourceLabel),
				set: AMENITY_ICON_SET,
			},
			id,
			labels: repeatLocalized(label),
			sourceLabel: group?.label ?? amenity.sourceLabel,
		});
	}

	return processed;
}

function amenityDedupeKey(id: string | null, label: string): string {
	return id ? `id:${id}` : `label:${label.toLowerCase()}`;
}

function extractAmenities(
	listing: Record<string, unknown>,
	sibling?: unknown,
): unknown[] {
	const value =
		firstArray(
			sibling,
			listing.amenities,
			listing.amenity_ids,
			listing.amenities_ids,
			listing.listing_amenities,
		) ?? [];

	return value.map((amenity) => sanitizeProviderPayload(amenity));
}

function extractAmenityInputs(amenities: unknown[]): NormalizedAmenityInput[] {
	return amenities
		.map((amenity) => {
			if (typeof amenity === "string") {
				return { id: null, sourceLabel: amenity };
			}

			if (typeof amenity === "number") {
				const id = String(amenity);
				return { id, sourceLabel: `Amenity ${id}` };
			}

			if (!isRecord(amenity)) {
				return null;
			}

			const id =
				readScalarString(amenity, "id") ??
				readScalarString(amenity, "amenity_id");
			const sourceLabel =
				readString(amenity, "name") ??
				readString(amenity, "label") ??
				readString(amenity, "title") ??
				readString(amenity, "description") ??
				(id ? `Amenity ${id}` : null);

			return sourceLabel ? { id, sourceLabel } : null;
		})
		.filter((amenity): amenity is NormalizedAmenityInput => amenity !== null);
}

function guideLines(key: string, value: unknown): string[] {
	if (typeof value === "string") {
		const text = cleanString(value);
		return text ? [`${key}: ${text}`] : [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((item, index) => guideLines(`${key}[${index}]`, item));
	}

	if (isRecord(value)) {
		return Object.entries(value).flatMap(([nestedKey, nested]) =>
			guideLines(`${key}.${nestedKey}`, nested),
		);
	}

	return [];
}

function readRequiredId(record: Record<string, unknown>): string {
	const id = readScalarString(record, "id");
	if (!id) {
		throw new Error("Hostify listing is missing an id");
	}

	return id;
}

function readDate(
	record: Record<string, unknown>,
	keys: readonly string[],
): Date | null {
	for (const key of keys) {
		const value = readScalarString(record, key);
		if (!value) {
			continue;
		}

		const date = new Date(value);
		if (!Number.isNaN(date.valueOf())) {
			return date;
		}
	}

	return null;
}

function readBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean | null {
	const value = record[key];

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value === 1;
	}

	if (typeof value === "string") {
		const normalized = value.toLowerCase();
		if (normalized === "true" || normalized === "1") {
			return true;
		}
		if (normalized === "false" || normalized === "0") {
			return false;
		}
	}

	return null;
}

/** First non-null numeric value across the given keys, in priority order. */
function readNumberFrom(
	record: Record<string, unknown>,
	keys: string[],
): number | null {
	for (const key of keys) {
		const value = readNumber(record, key);
		if (value !== null) return value;
	}
	return null;
}

function readNumber(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];

	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		if (value.trim() === "") {
			return null;
		}
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function readString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" ? cleanString(value) : null;
}

function readScalarString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];

	if (typeof value === "string") {
		return cleanString(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return null;
}

function cleanString(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function firstArray(...values: unknown[]): unknown[] | null {
	for (const value of values) {
		if (Array.isArray(value)) {
			return value;
		}
	}

	return null;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
