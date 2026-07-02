import type { OrderBillingAddressSnapshot } from "@workspace/db";
import { z } from "zod";
import { parseQuoteBody, type QuoteRequest } from "../accommodations";
import type { BookingGuestUpdateInput } from "./order-guests";
import type { DraftOrderContactInput } from "./types";

const idString = z.string().trim().min(1).max(128);
const optionalIdString = idString.optional();
const idempotencyKey = z
	.string()
	.trim()
	.min(8)
	.max(160)
	.regex(
		/^[A-Za-z0-9._:-]+$/,
		"Use letters, numbers, dots, underscores, dashes or colons",
	);

const createCartSchema = z.object({
	// Server-generated UUIDs only: unguessable, and removes the colon-collision
	// risk in idempotency scopes such as `cart:${cartId}:items:create`.
	cartId: z.string().uuid().optional(),
	idempotencyKey: idempotencyKey.optional(),
});

const addCartItemSchema = z.object({
	adults: z.coerce.number().int().min(1).max(30).optional(),
	checkIn: z.string(),
	checkOut: z.string(),
	children: z.coerce.number().int().min(0).max(30).optional(),
	clientMutationId: optionalIdString,
	guests: z.coerce.number().int().min(1).max(30),
	idempotencyKey,
	infants: z.coerce.number().int().min(0).max(5).optional(),
	listingId: idString,
	pets: z.coerce.number().int().min(0).max(10).optional(),
});

const updateCartItemSchema = z.object({
	adults: z.coerce.number().int().min(1).max(30).optional(),
	checkIn: z.string().optional(),
	checkOut: z.string().optional(),
	children: z.coerce.number().int().min(0).max(30).optional(),
	guests: z.coerce.number().int().min(1).max(30).optional(),
	idempotencyKey,
	infants: z.coerce.number().int().min(0).max(5).optional(),
	listingId: optionalIdString,
	pets: z.coerce.number().int().min(0).max(10).optional(),
});

const deleteCartItemSchema = z.object({
	idempotencyKey: idempotencyKey.optional(),
});

const applyDiscountSchema = z.object({
	// Stripe promotion codes: letters, digits and dashes, case-insensitive.
	code: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers or dashes"),
	idempotencyKey: idempotencyKey.optional(),
});

const createPaymentIntentSchema = z.object({
	cartId: z.string().uuid(),
	idempotencyKey: idempotencyKey.optional(),
	// Optional: when absent, the route resolves the payable order from the cart
	// (used to resume a converted cart whose order id was not retained client-side).
	orderId: z.string().uuid().optional(),
});

const addressLine = z.string().trim().min(1).max(200);
const billingAddressSchema: z.ZodType<OrderBillingAddressSnapshot> = z
	.object({
		city: addressLine.optional(),
		country: addressLine.optional(),
		line1: addressLine.optional(),
		line2: addressLine.optional(),
		postalCode: addressLine.optional(),
		region: addressLine.optional(),
	})
	.catchall(z.unknown())
	.default({});

const rawContactSchema = z
	.object({
		billingAddress: billingAddressSchema.optional(),
		companyName: z.string().trim().min(1).max(200).optional(),
		email: z.string().trim().email().max(320),
		isCompany: z.boolean().optional().default(false),
		name: z.string().trim().min(1).max(200),
		notes: z.string().trim().max(1000).optional(),
		phone: z.string().trim().min(3).max(64).optional(),
		phoneE164: z.string().trim().min(3).max(64).optional(),
		taxNumber: z.string().trim().min(1).max(64).optional(),
	})
	.superRefine((value, context) => {
		if (!value.phone && !value.phoneE164) {
			context.addIssue({
				code: "custom",
				message: "Phone is required",
				path: ["phone"],
			});
		}
	})
	.transform(
		(value): DraftOrderContactInput => ({
			billingAddress: value.billingAddress ?? {},
			companyName: value.companyName ?? null,
			email: value.email.toLowerCase(),
			isCompany: value.isCompany,
			name: value.name,
			notes: value.notes ?? null,
			phoneE164: value.phoneE164 ?? value.phone ?? "",
			taxNumber: value.taxNumber ?? null,
		}),
	);

const draftOrderSchema = z.object({
	billingAddress: billingAddressSchema.optional(),
	cartId: idString,
	companyName: z.string().trim().min(1).max(200).optional(),
	contact: rawContactSchema.optional(),
	email: z.string().trim().email().max(320).optional(),
	idempotencyKey: idempotencyKey.optional(),
	isCompany: z.boolean().optional(),
	name: z.string().trim().min(1).max(200).optional(),
	notes: z.string().trim().max(1000).optional(),
	phone: z.string().trim().min(3).max(64).optional(),
	phoneE164: z.string().trim().min(3).max(64).optional(),
	taxNumber: z.string().trim().min(1).max(64).optional(),
});

const draftOrderContactFieldsSchema = draftOrderSchema.pick({
	billingAddress: true,
	companyName: true,
	email: true,
	isCompany: true,
	name: true,
	notes: true,
	phone: true,
	phoneE164: true,
	taxNumber: true,
});

const isoDateString = z.iso.date("Use YYYY-MM-DD");

const optionalIsoDateString = isoDateString
	.nullish()
	.transform((value) => value ?? null);
const countryCode = z
	.string()
	.trim()
	.regex(/^[A-Za-z]{2}$/, "Use an ISO 3166-1 alpha-2 country code")
	.transform((value) => value.toUpperCase());
const optionalGuestField = (maxLength: number) =>
	z
		.string()
		.trim()
		.min(1)
		.max(maxLength)
		.nullish()
		.transform((value) => value ?? null);

const guestIdentityFieldsSchema = z
	.object({
		dateOfBirth: isoDateString,
		documentExpiresOn: optionalIsoDateString,
		documentIssuingCountry: countryCode
			.nullish()
			.transform((value) => value ?? null),
		documentNumber: optionalGuestField(80),
		documentType: optionalGuestField(80),
		firstName: z.string().trim().min(1).max(120),
		lastName: z.string().trim().min(1).max(120),
		nationality: countryCode,
		residenceCountry: countryCode,
	})
	.superRefine((value, context) => {
		if (
			!(
				(value.documentType &&
					value.documentNumber &&
					value.documentIssuingCountry) ||
				(!value.documentType &&
					!value.documentNumber &&
					!value.documentIssuingCountry)
			)
		) {
			context.addIssue({
				code: "custom",
				message: "All document fields are required",
				path: ["documentType"],
			});
		}
	});

const bookingGuestUpdateSchema = z.object({
	fields: guestIdentityFieldsSchema,
	id: idString.nullish().transform((value) => value ?? null),
});

const updateBookingGuestsSchema = z.object({
	guests: z.array(bookingGuestUpdateSchema).min(1).max(30),
});

export type CommerceParseResult<T> =
	| { data: T; success: true }
	| { error: z.ZodError; success: false };

export interface CreateCartBody {
	cartId?: string;
	idempotencyKey?: string;
}

export interface AddCartItemBody extends QuoteRequest {
	clientMutationId?: string;
	idempotencyKey: string;
}

export interface UpdateCartItemBody {
	adults?: number;
	checkIn?: string;
	checkOut?: string;
	children?: number;
	guests?: number;
	idempotencyKey: string;
	infants?: number;
	listingId?: string;
	pets?: number;
}

export interface DeleteCartItemBody {
	idempotencyKey?: string;
}

export interface ApplyDiscountBody {
	code: string;
	idempotencyKey?: string;
}

export interface DraftOrderBody {
	cartId: string;
	contact: DraftOrderContactInput;
	idempotencyKey?: string;
}

export interface CreatePaymentIntentBody {
	cartId: string;
	idempotencyKey?: string;
	orderId?: string;
}

export interface UpdateBookingGuestsBody {
	guests: BookingGuestUpdateInput[];
}

export function parseCreateCartBody(
	body: unknown,
): CommerceParseResult<CreateCartBody> {
	return createCartSchema.safeParse(body ?? {});
}

export function parseAddCartItemBody(
	body: unknown,
): CommerceParseResult<AddCartItemBody> {
	const parsed = addCartItemSchema.safeParse(body);
	if (!parsed.success) {
		return parsed;
	}

	// Cart-add reuses the quote the widget already warmed for these exact dates;
	// the reservation hold re-checks availability before any charge.
	const quote = parseQuoteBody({ ...parsed.data, forceFresh: false });
	if (!quote.success) {
		return quote;
	}

	return {
		data: {
			...quote.data,
			clientMutationId: parsed.data.clientMutationId,
			idempotencyKey: parsed.data.idempotencyKey,
		},
		success: true,
	};
}

export function parseUpdateCartItemBody(
	body: unknown,
): CommerceParseResult<UpdateCartItemBody> {
	return updateCartItemSchema.safeParse(body);
}

export function parseDeleteCartItemBody(
	body: unknown,
): CommerceParseResult<DeleteCartItemBody> {
	return deleteCartItemSchema.safeParse(body ?? {});
}

export function parseApplyDiscountBody(
	body: unknown,
): CommerceParseResult<ApplyDiscountBody> {
	return applyDiscountSchema.safeParse(body);
}

export function parseCreatePaymentIntentBody(
	body: unknown,
): CommerceParseResult<CreatePaymentIntentBody> {
	return createPaymentIntentSchema.safeParse(body);
}

export function parseUpdateBookingGuestsBody(
	body: unknown,
): CommerceParseResult<UpdateBookingGuestsBody> {
	return updateBookingGuestsSchema.safeParse(body);
}

/**
 * Parses a standalone contact update (the same nested contact shape the
 * draft-order route accepts under `contact`) into a normalized snapshot.
 */
export function parseOrderContactBody(
	body: unknown,
): CommerceParseResult<DraftOrderContactInput> {
	return rawContactSchema.safeParse(body);
}

export function parseDraftOrderBody(
	body: unknown,
): CommerceParseResult<DraftOrderBody> {
	const parsed = draftOrderSchema.safeParse(body);
	if (!parsed.success) {
		return parsed;
	}

	// Checkout accepts either a nested contact object or legacy flat contact
	// fields, then normalizes both paths into the same contact snapshot. When
	// both are present, the nested contact object takes precedence.
	if (parsed.data.contact) {
		return {
			data: {
				cartId: parsed.data.cartId,
				contact: parsed.data.contact,
				idempotencyKey: parsed.data.idempotencyKey,
			},
			success: true,
		};
	}

	const contactFields = draftOrderContactFieldsSchema.safeParse(parsed.data);
	if (!contactFields.success) {
		return contactFields;
	}

	const contact = rawContactSchema.safeParse(contactFields.data);
	if (!contact.success) {
		return contact;
	}

	return {
		data: {
			cartId: parsed.data.cartId,
			contact: contact.data,
			idempotencyKey: parsed.data.idempotencyKey,
		},
		success: true,
	};
}
