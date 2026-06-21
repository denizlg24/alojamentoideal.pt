import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STAY_NIGHTS = 90;

const dateString = z.string().regex(DATE_PATTERN, "Expected YYYY-MM-DD");

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
	listingId: string;
	pets: number;
}

export interface SearchRequest extends AvailabilityRequest {
	quoteVisible: boolean;
}

const availabilitySchema = z.object({
	checkIn: dateString,
	checkOut: dateString,
	forceFresh: z
		.union([z.literal("true"), z.literal("1")])
		.optional()
		.transform((value) => value !== undefined),
	guests: z.coerce.number().int().min(1).max(30),
});

const quoteSchema = z.object({
	checkIn: dateString,
	checkOut: dateString,
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

	return {
		data: {
			dates: dates.data,
			forceFresh: parsed.data.forceFresh,
			guests: parsed.data.guests,
			listingId: parsed.data.listingId,
			pets: parsed.data.pets,
		},
		success: true,
	};
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
