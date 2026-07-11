import { z } from "zod";

export const CATALOG_LOCALES = ["en", "pt", "es"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

export const CATALOG_SORTS = [
	"relevance",
	"distance",
	"recent",
	"capacity",
	"name",
	"price_asc",
	"price_desc",
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export interface CatalogRadius {
	latitude: number;
	longitude: number;
	radiusKm: number;
}

export interface CatalogListQuery {
	amenities: string[];
	bathroomsMin: number | null;
	bedroomsMin: number | null;
	city: string | null;
	country: string | null;
	includeInactive: boolean;
	limit: number;
	locale: CatalogLocale;
	minGuests: number | null;
	offset: number;
	petFriendlyOnly?: boolean;
	priceMax: number | null;
	priceMin: number | null;
	propertyType: string | null;
	radius: CatalogRadius | null;
	ratingMin: number | null;
	sort: CatalogSort;
	text: string | null;
}

const optionalText = z
	.string()
	.trim()
	.min(1)
	.optional()
	.transform((value) => value ?? null);

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);
const radiusKm = z.coerce.number().positive().max(20_000);

const baseSchema = z.object({
	amenities: z.array(z.string().trim().min(1)).max(50).default([]),
	bathroomsMin: z.coerce.number().min(0).optional(),
	bedroomsMin: z.coerce.number().min(0).optional(),
	city: optionalText,
	country: optionalText,
	includeInactive: z
		.enum(["true", "false", "1", "0"])
		.optional()
		.transform((value) => value === "true" || value === "1"),
	lang: z.enum(CATALOG_LOCALES).optional(),
	lat: latitude.optional(),
	limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
	lng: longitude.optional(),
	minGuests: z.coerce.number().int().min(1).optional(),
	offset: z.coerce.number().int().min(0).optional(),
	petFriendly: z
		.enum(["true", "false", "1", "0"])
		.optional()
		.transform((value) => value === "true" || value === "1"),
	priceMax: z.coerce.number().min(0).optional(),
	priceMin: z.coerce.number().min(0).optional(),
	propertyType: optionalText,
	q: optionalText,
	radiusKm: radiusKm.optional(),
	ratingMin: z.coerce.number().min(0).max(5).optional(),
	sort: z.enum(CATALOG_SORTS).optional(),
});

const listQuerySchema = baseSchema
	.refine(
		(value) => {
			const definedCount = [value.lat, value.lng, value.radiusKm].filter(
				(part) => part !== undefined,
			).length;
			return definedCount === 0 || definedCount === 3;
		},
		{
			message:
				"lat, lng and radiusKm must be provided together for radius search",
			path: ["radiusKm"],
		},
	)
	.refine((value) => value.sort !== "distance" || value.lat !== undefined, {
		message: "sort=distance requires lat, lng and radiusKm",
		path: ["sort"],
	});

export type CatalogListQueryParseResult =
	| { error: z.ZodError; success: false }
	| { data: CatalogListQuery; success: true };

export function parseCatalogListQuery(
	searchParams: URLSearchParams,
): CatalogListQueryParseResult {
	const parsed = listQuerySchema.safeParse({
		amenities: readAmenities(searchParams),
		bathroomsMin: searchParams.get("bathroomsMin") ?? undefined,
		bedroomsMin: searchParams.get("bedroomsMin") ?? undefined,
		city: searchParams.get("city") ?? undefined,
		country: searchParams.get("country") ?? undefined,
		includeInactive: searchParams.get("includeInactive") ?? undefined,
		lang: searchParams.get("lang") ?? undefined,
		lat: searchParams.get("lat") ?? undefined,
		limit: searchParams.get("limit") ?? undefined,
		lng: searchParams.get("lng") ?? undefined,
		minGuests: searchParams.get("guests") ?? undefined,
		offset: searchParams.get("offset") ?? undefined,
		petFriendly: searchParams.get("petFriendly") ?? undefined,
		priceMax: searchParams.get("priceMax") ?? undefined,
		priceMin: searchParams.get("priceMin") ?? undefined,
		propertyType: searchParams.get("propertyType") ?? undefined,
		q: searchParams.get("q") ?? undefined,
		radiusKm: searchParams.get("radiusKm") ?? undefined,
		ratingMin: searchParams.get("ratingMin") ?? undefined,
		sort: searchParams.get("sort") ?? undefined,
	});

	if (!parsed.success) {
		return { error: parsed.error, success: false };
	}

	const value = parsed.data;
	const radius =
		value.lat !== undefined &&
		value.lng !== undefined &&
		value.radiusKm !== undefined
			? { latitude: value.lat, longitude: value.lng, radiusKm: value.radiusKm }
			: null;

	return {
		data: {
			amenities: dedupe(value.amenities),
			bathroomsMin: value.bathroomsMin ?? null,
			bedroomsMin: value.bedroomsMin ?? null,
			city: value.city,
			country: value.country,
			includeInactive: value.includeInactive ?? false,
			limit: value.limit ?? DEFAULT_LIMIT,
			locale: value.lang ?? "en",
			minGuests: value.minGuests ?? null,
			offset: value.offset ?? 0,
			petFriendlyOnly: value.petFriendly ?? false,
			priceMax: value.priceMax ?? null,
			priceMin: value.priceMin ?? null,
			propertyType: value.propertyType,
			radius,
			ratingMin: value.ratingMin ?? null,
			sort:
				value.sort ?? (value.q ? "relevance" : radius ? "distance" : "recent"),
			text: value.q,
		},
		success: true,
	};
}

export function parseCatalogLocale(
	value: string | null | undefined,
): CatalogLocale {
	return CATALOG_LOCALES.includes(value as CatalogLocale)
		? (value as CatalogLocale)
		: "en";
}

function readAmenities(searchParams: URLSearchParams): string[] {
	return searchParams
		.getAll("amenities")
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}
