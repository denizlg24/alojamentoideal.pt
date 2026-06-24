import { z } from "zod";

/**
 * Shared profile-form schema used for both client-side validation (before
 * submit) and server-side validation (in the PUT route). Intentionally depends
 * only on `zod` so it is safe to import from client components. The parsed
 * output is structurally an `AccountProfileInput`; the route asserts that link.
 *
 * Every text field normalizes empty/whitespace input to `null` so the database
 * stores a clean absence rather than empty strings.
 */
const MAX_TEXT = 200;

function optionalText(max: number = MAX_TEXT) {
	return z
		.string()
		.trim()
		.max(max)
		.optional()
		.nullable()
		.transform((value) => (value && value.length > 0 ? value : null));
}

const optionalCountry = z
	.string()
	.trim()
	.toUpperCase()
	.optional()
	.nullable()
	.transform((value) => (value && value.length > 0 ? value : null))
	.refine((value) => value === null || /^[A-Z]{2}$/.test(value), {
		message: "Use a 2-letter country code",
	});

const optionalPhone = z
	.string()
	.optional()
	.nullable()
	.transform((value) => {
		if (!value) {
			return null;
		}
		const normalized = value.replace(/[\s().-]/g, "");
		return normalized.length > 0 ? normalized : null;
	})
	.refine((value) => value === null || /^\+[1-9]\d{6,14}$/.test(value), {
		message: "Enter the number in international format, e.g. +351912345678",
	});

export const profileUpdateSchema = z
	.object({
		phoneE164: optionalPhone,
		isCompany: z
			.boolean()
			.optional()
			.transform((value) => value ?? false),
		companyName: optionalText(120),
		taxNumber: optionalText(40),
		billingLine1: optionalText(),
		billingLine2: optionalText(),
		billingCity: optionalText(120),
		billingRegion: optionalText(120),
		billingPostalCode: optionalText(20),
		billingCountry: optionalCountry,
		residenceCountry: optionalCountry,
		nationality: optionalCountry,
	})
	.refine((data) => !data.isCompany || (data.companyName?.length ?? 0) > 0, {
		message: "Company name is required for company billing",
		path: ["companyName"],
	});

export type ProfileUpdateValues = z.infer<typeof profileUpdateSchema>;
