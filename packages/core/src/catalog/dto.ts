import type {
	AccommodationListingProcessedContent,
	AccommodationListingRawContent,
	LocalizedText,
	ProcessedAmenity,
} from "@workspace/db";
import { hostifyPropertyTypeLabel } from "../hostify-property-types";
import { publicAmenityGroupForInput } from "../listing-cache/amenity-groups";
import {
	cleanDescriptionSectionBody,
	LISTING_DESCRIPTION_SECTIONS,
} from "../listing-cache/localization";
import type { CatalogLocale } from "./params";

export interface CatalogAmenityDto {
	icon: { name: string; set: string };
	id: string | null;
	key: string;
	label: string;
}

export interface CatalogPhotoDto {
	caption: string | null;
	thumbnailUrl: string | null;
	url: string;
}

export interface CatalogRoomBedDto {
	count: number | null;
	type: string | null;
}

export interface CatalogRoomDto {
	beds: CatalogRoomBedDto[];
	capacity: number | null;
	name: string | null;
	shared: boolean;
	type: string | null;
}

export interface CatalogDescriptionSection {
	body: string;
	key: string;
	label: string;
}

export interface CatalogLocationDto {
	address: string | null;
	city: string | null;
	country: string | null;
	latitude: number | null;
	longitude: number | null;
	postalCode: string | null;
	state: string | null;
	timezone: string | null;
}

export interface CatalogCapacityDto {
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	guests: number | null;
}

export interface CatalogReviewsDto {
	/** Combined average across all sources, or null when there are no ratings. */
	average: number | null;
	count: number;
}

export interface CatalogFreshnessDto {
	active: boolean;
	fetchedAt: string;
	isStale: boolean;
	providerUpdatedAt: string | null;
	staleAfter: string;
}

export interface CatalogListingSummaryDto {
	amenities: CatalogAmenityDto[];
	amenityCount: number;
	capacity: CatalogCapacityDto;
	coverPhoto: CatalogPhotoDto | null;
	distanceKm: number | null;
	freshness: CatalogFreshnessDto;
	id: string;
	location: CatalogLocationDto;
	petFriendly: boolean;
	propertyType: string | null;
	provider: string;
	reviews: CatalogReviewsDto;
	title: string;
}

export interface CatalogListingDetailDto extends CatalogListingSummaryDto {
	/** Lead paragraph for the listing (also used for SEO/meta). */
	description: string;
	/** Labeled prose blocks (the space, guest access, neighborhood, ...). */
	descriptionSections: CatalogDescriptionSection[];
	guide: string;
	/** Listing-level default minimum nights; per-date calendar values override it. */
	minNights: number;
	nickname: string | null;
	photos: CatalogPhotoDto[];
	rooms: CatalogRoomDto[];
}

/** Columns and JSONB selected from `accommodation_listing` for catalog reads. */
export interface CatalogListingRecord {
	active: boolean;
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	city: string | null;
	country: string | null;
	externalId: string;
	fetchedAt: Date;
	latitude: number | null;
	longitude: number | null;
	name: string | null;
	nickname: string | null;
	personCapacity: number | null;
	petFriendly?: boolean;
	processed: AccommodationListingProcessedContent;
	propertyType: string | null;
	provider: string;
	providerUpdatedAt: Date | null;
	raw: AccommodationListingRawContent;
	reviewAverage: number | null;
	reviewCount: number;
	staleAfter: Date;
	timezone: string | null;
}

export interface CatalogMapOptions {
	distanceKm?: number | null;
	locale: CatalogLocale;
	now?: Date;
}

export function toCatalogListingSummary(
	record: CatalogListingRecord,
	options: CatalogMapOptions,
): CatalogListingSummaryDto {
	const now = options.now ?? new Date();
	const photos = extractPhotos(record.raw);
	const amenities = toCatalogAmenities(
		record.processed.amenities,
		options.locale,
	);

	return {
		amenities,
		amenityCount: amenities.length,
		capacity: {
			bathrooms: record.bathrooms,
			bedrooms: record.bedrooms,
			beds: record.beds,
			guests: record.personCapacity,
		},
		coverPhoto: photos[0] ?? null,
		distanceKm: roundDistance(options.distanceKm),
		freshness: toFreshness(record, now),
		id: record.externalId,
		location: {
			address:
				readRawListingString(record.raw, "address") ??
				readRawListingString(record.raw, "street"),
			city: record.city,
			country: record.country,
			latitude: record.latitude,
			longitude: record.longitude,
			postalCode:
				readRawListingString(record.raw, "zipcode") ??
				readRawListingString(record.raw, "zip_code") ??
				readRawListingString(record.raw, "zip"),
			state: readRawListingString(record.raw, "state"),
			timezone: record.timezone,
		},
		petFriendly: record.petFriendly ?? false,
		propertyType: pickPropertyType(record),
		provider: record.provider,
		reviews: {
			average: record.reviewCount > 0 ? record.reviewAverage : null,
			count: record.reviewCount,
		},
		title: pickTitle(record, options.locale),
	};
}

export function toCatalogListingDetail(
	record: CatalogListingRecord,
	options: CatalogMapOptions,
): CatalogListingDetailDto {
	const lead = pickDescriptionLead(record, options.locale);

	return {
		...toCatalogListingSummary(record, options),
		description: lead,
		descriptionSections: extractDescriptionSections(
			record,
			lead,
			options.locale,
		),
		guide: pickLocalized(record.processed.guide, options.locale),
		minNights: readRawListingNumber(record.raw, "min_nights") ?? 2,
		nickname: record.nickname,
		photos: extractPhotos(record.raw),
		rooms: extractRooms(record.raw),
	};
}

/**
 * Hostify splits listing prose across `description` sibling fields (Airbnb's
 * model). These map to public, labeled sections in render order. `summary` and
 * `description` feed the lead paragraph, so they are not repeated here.
 */
function readDescriptionRecord(
	raw: AccommodationListingRawContent,
): Record<string, unknown> {
	return isRecord(raw.description) ? raw.description : {};
}

/**
 * The lead paragraph: the LLM-processed description when present, otherwise the
 * raw `summary`/`description`/`space` fallback chain so the 6-in-26 listings
 * with an empty `description` field still get a blurb.
 */
function pickDescriptionLead(
	record: CatalogListingRecord,
	locale: CatalogLocale,
): string {
	const processed = pickLocalized(record.processed.description, locale);
	if (processed) {
		return processed;
	}

	const description = readDescriptionRecord(record.raw);
	return (
		readString(description.summary) ??
		readString(description.description) ??
		readString(description.space) ??
		""
	);
}

function extractDescriptionSections(
	record: CatalogListingRecord,
	lead: string,
	locale: CatalogLocale,
): CatalogDescriptionSection[] {
	const description = readDescriptionRecord(record.raw);
	const rawLead =
		readString(description.summary) ??
		readString(description.description) ??
		readString(description.space);
	const sections: CatalogDescriptionSection[] = [];

	for (const { key, label } of LISTING_DESCRIPTION_SECTIONS) {
		const rawBody = cleanDescriptionSectionBody(readString(description[key]));
		// Skip empty source sections and anything already shown as the lead
		// paragraph. Processed content is allowed to translate a real source
		// section, but not to create one from a stale provider translation.
		if (!rawBody || rawBody === rawLead) {
			continue;
		}

		const body =
			pickLocalizedSection(
				record.processed.descriptionSections?.[key],
				locale,
			) || rawBody;
		if (body && body !== lead) {
			sections.push({ body, key, label: label[locale] });
		}
	}

	return sections;
}

function toFreshness(
	record: CatalogListingRecord,
	now: Date,
): CatalogFreshnessDto {
	return {
		active: record.active,
		fetchedAt: record.fetchedAt.toISOString(),
		isStale: record.staleAfter.getTime() <= now.getTime(),
		providerUpdatedAt: record.providerUpdatedAt?.toISOString() ?? null,
		staleAfter: record.staleAfter.toISOString(),
	};
}

function toAmenity(
	amenity: ProcessedAmenity,
	locale: CatalogLocale,
): CatalogAmenityDto {
	const group = publicAmenityGroupForInput({
		id: amenity.id,
		sourceLabel: amenity.sourceLabel,
	});

	if (group) {
		return {
			icon: { name: group.icon, set: amenity.icon.set },
			id: group.key,
			key: group.key,
			label: group.label,
		};
	}

	return {
		icon: { name: amenity.icon.name, set: amenity.icon.set },
		id: amenity.id,
		key: amenity.id ?? amenity.sourceLabel,
		label: pickLocalized(amenity.labels, locale) || amenity.sourceLabel,
	};
}

function toCatalogAmenities(
	amenities: ProcessedAmenity[],
	locale: CatalogLocale,
): CatalogAmenityDto[] {
	const seen = new Set<string>();
	const catalogAmenities: CatalogAmenityDto[] = [];

	for (const amenity of amenities) {
		const mapped = toAmenity(amenity, locale);
		if (seen.has(mapped.key)) {
			continue;
		}

		seen.add(mapped.key);
		catalogAmenities.push(mapped);
	}

	return catalogAmenities;
}

function pickPropertyType(record: CatalogListingRecord): string | null {
	return (
		record.propertyType ??
		readRawListingString(record.raw, "property_type") ??
		readRawListingString(record.raw, "property_type_group") ??
		hostifyPropertyTypeLabel(
			readRawListingString(record.raw, "property_type_id"),
		)
	);
}

function readRawListingString(
	raw: AccommodationListingRawContent,
	key: string,
): string | null {
	const listing = raw.listing;
	if (!isRecord(listing)) return null;

	const value = listing[key];
	if (typeof value === "string") return readString(value);
	if (typeof value === "number" || typeof value === "boolean") {
		return readString(String(value));
	}

	return null;
}

function readRawListingNumber(
	raw: AccommodationListingRawContent,
	key: string,
): number | null {
	const listing = raw.listing;
	return isRecord(listing) ? readNumber(listing[key]) : null;
}

function pickTitle(
	record: CatalogListingRecord,
	locale: CatalogLocale,
): string {
	return (
		pickLocalized(record.processed.title, locale) ||
		record.name ||
		record.nickname ||
		record.externalId
	);
}

function pickLocalized(
	text: LocalizedText | null | undefined,
	locale: CatalogLocale,
): string {
	return (text?.[locale] || text?.en || text?.pt || text?.es || "").trim();
}

function pickLocalizedSection(
	text: LocalizedText | null | undefined,
	locale: CatalogLocale,
): string {
	return cleanDescriptionSectionBody(text?.[locale]);
}

function roundDistance(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return null;
	}

	return Math.round(value * 100) / 100;
}

function extractPhotos(raw: AccommodationListingRawContent): CatalogPhotoDto[] {
	if (!Array.isArray(raw.photos)) {
		return [];
	}

	return raw.photos
		.map((entry, index) => toPhoto(entry, index))
		.filter(
			(photo): photo is { photo: CatalogPhotoDto; sortOrder: number } =>
				photo !== null,
		)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((entry) => entry.photo);
}

function toPhoto(
	entry: unknown,
	index: number,
): { photo: CatalogPhotoDto; sortOrder: number } | null {
	if (!isRecord(entry)) {
		return null;
	}

	const url = readString(entry.photo) ?? readString(entry.original_file);
	if (!url) {
		return null;
	}

	return {
		photo: {
			caption: readString(entry.name) ?? readString(entry.description),
			thumbnailUrl:
				readString(entry.thumbnail) ?? readString(entry.thumbnail_file),
			url,
		},
		sortOrder: readNumber(entry.sort_order) ?? index,
	};
}

function extractRooms(raw: AccommodationListingRawContent): CatalogRoomDto[] {
	if (!Array.isArray(raw.rooms)) {
		return [];
	}

	return raw.rooms
		.map((entry) => toRoom(entry))
		.filter((room): room is CatalogRoomDto => room !== null);
}

function toRoom(entry: unknown): CatalogRoomDto | null {
	if (!isRecord(entry)) {
		return null;
	}

	const beds = Array.isArray(entry.beds)
		? entry.beds
				.map((bed) => toBed(bed))
				.filter((bed): bed is CatalogRoomBedDto => bed !== null)
		: [];

	return {
		beds,
		capacity: readNumber(entry.person_capacity),
		name: readString(entry.name),
		shared: entry.shared === 1 || entry.shared === true,
		type: readString(entry.room_type),
	};
}

function toBed(entry: unknown): CatalogRoomBedDto | null {
	if (!isRecord(entry)) {
		return null;
	}

	const type = readString(entry.type);
	const count = readNumber(entry.count);
	if (type === null && count === null) {
		return null;
	}

	return { count, type };
}

function readString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
