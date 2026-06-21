import type {
	AccommodationListingNormalizedContent,
	AccommodationListingRawContent,
	ListingSectionHashes,
	LocalizedText,
	ProcessedAmenity,
} from "@workspace/db";
import { hostifyPropertyTypeLabel } from "../hostify-property-types";
import { AMENITY_ICON_SET, pickAmenityIcon } from "./amenity-icons";
import { sanitizeProviderPayload, stableHash } from "./hash";

export interface HostifyListingSections {
	fees: unknown;
	guestGuide: unknown;
	listing: unknown;
	photos: unknown;
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
	const amenities = extractAmenities(listing);
	const title = readString(listing, "name") ?? readString(listing, "nickname");
	const description = readString(listing, "description");
	const guideText = guideToText(raw.guestGuide);

	const normalized: AccommodationListingNormalizedContent = {
		amenities,
		description,
		guide: raw.guestGuide,
		listing,
		title,
		translations,
	};

	const sectionHashes: ListingSectionHashes = {
		amenities: stableHash(amenities),
		description: stableHash({ description }),
		fees: stableHash(raw.fees),
		guide: stableHash(raw.guestGuide),
		location: stableHash({
			address: readString(listing, "address"),
			city: readString(listing, "city"),
			country: readString(listing, "country"),
			latitude: readNumberFrom(listing, ["lat", "latitude"]),
			longitude: readNumberFrom(listing, ["lng", "longitude"]),
			state: readString(listing, "state"),
			timezone: readString(listing, "timezone"),
			zipcode: readScalarString(listing, "zipcode"),
		}),
		photos: stableHash(raw.photos),
		status: stableHash(raw.status),
		title: stableHash({
			name: readString(listing, "name"),
			nickname: readString(listing, "nickname"),
		}),
		translations: stableHash(translations),
	};

	return {
		active: readBoolean(listing, "active") ?? true,
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
			amenities: toFallbackAmenities(amenities),
			description: repeatLocalized(description),
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
		sourceHash: stableHash(raw),
		timezone: readString(listing, "timezone"),
	};
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
		fees: sanitizeProviderPayload(sections.fees),
		guestGuide: sanitizeProviderPayload(sections.guestGuide),
		listing: sanitizeProviderPayload(sections.listing),
		photos: sanitizeProviderPayload(sections.photos),
		status: sanitizeProviderPayload(sections.status),
		translations: sanitizeProviderPayload(sections.translations),
	};
}

function toFallbackAmenities(amenities: unknown[]): ProcessedAmenity[] {
	return extractAmenityInputs(amenities).map((amenity) => ({
		icon: {
			name: pickAmenityIcon(amenity.sourceLabel),
			set: AMENITY_ICON_SET,
		},
		id: amenity.id,
		labels: repeatLocalized(amenity.sourceLabel),
		sourceLabel: amenity.sourceLabel,
	}));
}

function extractAmenities(listing: Record<string, unknown>): unknown[] {
	const value =
		firstArray(
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
