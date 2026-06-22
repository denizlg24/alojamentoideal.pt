import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STAY_NIGHTS = 90;

const dateString = z
	.string()
	.regex(DATE_PATTERN, "Expected YYYY-MM-DD")
	.refine(
		(value) => {
			const date = new Date(`${value}T00:00:00.000Z`);
			return !Number.isNaN(date.getTime());
		},
		{ message: "Invalid calendar date" },
	);

export interface StayDates {
	checkIn: string;
	checkOut: string;
	nights: number;
}

export interface AvailabilityRequest {
	dates: StayDates;
	forceFresh: boolean;
	guests: number;
}

export interface QuoteRequest extends AvailabilityRequest {
	accountId?: string;
	adults: number;
	children: number;
	listingId: string;
	pets: number;
	providerId?: string;
}

export interface SearchRequest extends AvailabilityRequest {
	quoteVisible: boolean;
}

const availabilitySchema = z.object({
	checkIn: dateString,
	checkOut: dateString,
	forceFresh: z
		.union([
			z.literal("true"),
			z.literal("1"),
			z.literal("false"),
			z.literal("0"),
		])
		.optional()
		.transform((value) => value === "true" || value === "1"),
	guests: z.coerce.number().int().min(1).max(30),
});

const quoteSchema = z.object({
	adults: z.coerce.number().int().min(1).max(30).optional(),
	checkIn: dateString,
	checkOut: dateString,
	children: z.coerce.number().int().min(0).max(30).optional(),
	forceFresh: z.boolean().optional().default(false),
	guests: z.coerce.number().int().min(1).max(30),
	listingId: z.string().trim().min(1),
	pets: z.coerce.number().int().min(0).max(10).optional().default(0),
});

export type AccommodationParseResult<T> =
	| { error: z.ZodError; success: false }
	| { data: T; success: true };

export function parseAvailabilitySearchParams(
	searchParams: URLSearchParams,
): AccommodationParseResult<AvailabilityRequest> {
	const parsed = availabilitySchema.safeParse({
		checkIn: searchParams.get("checkIn") ?? undefined,
		checkOut: searchParams.get("checkOut") ?? undefined,
		forceFresh: searchParams.get("forceFresh") ?? undefined,
		guests: searchParams.get("guests") ?? undefined,
	});

	if (!parsed.success) {
		return { error: parsed.error, success: false };
	}

	const dates = parseStayDates(parsed.data.checkIn, parsed.data.checkOut);
	if (!dates.success) {
		return dates;
	}

	return {
		data: {
			dates: dates.data,
			forceFresh: parsed.data.forceFresh,
			guests: parsed.data.guests,
		},
		success: true,
	};
}

export function parseQuoteBody(
	body: unknown,
): AccommodationParseResult<QuoteRequest> {
	const parsed = quoteSchema.safeParse(body);
	if (!parsed.success) {
		return { error: parsed.error, success: false };
	}

	const dates = parseStayDates(parsed.data.checkIn, parsed.data.checkOut);
	if (!dates.success) {
		return dates;
	}

	const split = resolveGuestSplit(parsed.data);
	if (!split.success) {
		return split;
	}

	return {
		data: {
			adults: split.data.adults,
			children: split.data.children,
			dates: dates.data,
			forceFresh: parsed.data.forceFresh,
			guests: parsed.data.guests,
			listingId: parsed.data.listingId,
			pets: parsed.data.pets,
		},
		success: true,
	};
}

/**
 * Splits the total `guests` count into adults/children. When `adults` is
 * omitted it is derived as `guests - children` (not `guests`), so passing
 * `children` alone does not double-count occupants and skew adult-only tax
 * math. The resolved split must keep at least one adult and not exceed the
 * total guest count.
 */
function resolveGuestSplit(input: {
	adults?: number;
	children?: number;
	guests: number;
}): AccommodationParseResult<{ adults: number; children: number }> {
	const children = input.children ?? 0;
	const adults = input.adults ?? input.guests - children;

	if (adults < 1 || adults + children > input.guests) {
		return {
			error: new z.ZodError([
				{
					code: "custom",
					input: input.adults,
					message: "Adults and children must fit within the total guest count",
					path: ["adults"],
				},
			]),
			success: false,
		};
	}

	return { data: { adults, children }, success: true };
}

function parseStayDates(
	checkIn: string,
	checkOut: string,
): AccommodationParseResult<StayDates> {
	const start = toUtcDate(checkIn);
	const end = toUtcDate(checkOut);
	const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);

	if (nights < 1 || nights > MAX_STAY_NIGHTS) {
		return {
			error: new z.ZodError([
				{
					code: "custom",
					input: checkOut,
					message: `Stay must be between 1 and ${MAX_STAY_NIGHTS} nights`,
					path: ["checkOut"],
				},
			]),
			success: false,
		};
	}

	return { data: { checkIn, checkOut, nights }, success: true };
}

function toUtcDate(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`);
}
