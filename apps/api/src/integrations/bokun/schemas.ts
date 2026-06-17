import { z } from "zod";

const idSchema = z.union([z.number(), z.string()]);
const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();

/** Passthrough object/array for the large Bokun DTOs we do not type field-by-field. */
const bokunObject = z.looseObject({});
const bokunObjectArray = z.array(bokunObject);

/** Empty/void responses (DELETE, 204, or endpoints returning no JSON body). */
const bokunVoidSchema = z.unknown();

/** Non-JSON responses such as tickets and booking summaries (HTML/text/PDF). */
const bokunTextSchema = z.string();

const entitySchema = z.looseObject({ id: idSchema.optional() });

/* ------------------------------------------------------------------ */
/* v1 schemas                                                          */
/* ------------------------------------------------------------------ */

export const bokunApiResponseSchema = z.looseObject({
	fields: z.record(z.string(), z.unknown()).nullable().optional(),
	message: nullableString,
});

export const bokunAccommodationSchema = entitySchema.extend({
	slug: nullableString,
	title: nullableString,
});

export const bokunActivitySchema = entitySchema.extend({
	published: nullableBoolean,
	slug: nullableString,
	title: nullableString,
});

export const bokunBookingDetailsSchema = entitySchema.extend({
	confirmationCode: nullableString,
	status: nullableString,
	totalPrice: nullableNumber,
});

export const bokunShoppingCartSchema = z.looseObject({
	sessionId: nullableString,
});

export const bokunCheckoutResponseSchema = z.looseObject({
	booking: bokunObject.nullable().optional(),
	confirmationCode: nullableString,
	success: nullableBoolean,
});

/* ------------------------------------------------------------------ */
/* v2 schemas                                                          */
/* ------------------------------------------------------------------ */

export const bokunStandardErrorSchema = z.looseObject({
	error: z.string(),
});

const pagedListSchema = <TItem extends z.ZodType>(item: TItem) =>
	z.looseObject({
		items: z.array(item),
		pageNo: nullableNumber,
		pageSize: nullableNumber,
		totalCount: nullableNumber,
		totalPages: nullableNumber,
	});

export const bokunPricingCategorySchema = z.looseObject({
	id: idSchema,
	occupancy: nullableNumber,
	title: z.string(),
});

export const bokunPromoCodeSchema = z.looseObject({
	code: z.string(),
	description: nullableString,
	id: idSchema,
});

export const bokunTaxSchema = z.looseObject({
	id: idSchema,
	included: nullableBoolean,
	percentage: nullableString,
	title: z.string(),
});

export const bokunCustomerSchema = z.looseObject({
	email: nullableString,
	firstName: nullableString,
	id: idSchema.optional(),
	lastName: nullableString,
});

export const bokunExperienceAvailabilitySchema = z.looseObject({
	date: z.string(),
	remainingPax: nullableNumber,
	startTimeId: idSchema.optional(),
	time: nullableString,
});

/* ------------------------------------------------------------------ */
/* Registry consumed by the client                                     */
/* ------------------------------------------------------------------ */

export const bokunSchemas = {
	accommodation: bokunAccommodationSchema,
	activity: bokunActivitySchema,
	activityArray: z.array(bokunActivitySchema),
	apiResponse: bokunApiResponseSchema,
	bookingDetails: bokunBookingDetailsSchema,
	bookingDetailsArray: z.array(bokunBookingDetailsSchema),
	cancellationPolicies: pagedListSchema(bokunObject),
	checkout: bokunObject,
	checkoutResponse: bokunCheckoutResponseSchema,
	customer: bokunCustomerSchema,
	experienceAvailability: z.array(bokunExperienceAvailabilitySchema),
	experienceAllocation: bokunObject,
	experienceAllocations: pagedListSchema(bokunObject),
	experienceBookingNote: bokunObject,
	experienceBookingNotes: bokunObjectArray,
	experienceComponents: bokunObject,
	idArray: z.array(z.number()),
	object: bokunObject,
	objectArray: bokunObjectArray,
	priceCatalogs: pagedListSchema(bokunObject),
	priceSchedule: bokunObject,
	priceSchedules: pagedListSchema(bokunObject),
	pricingCategories: pagedListSchema(bokunPricingCategorySchema),
	pricingCategory: bokunPricingCategorySchema,
	productList: bokunObject,
	productListDescriptions: bokunObjectArray,
	promoCode: bokunPromoCodeSchema,
	promoCodes: pagedListSchema(bokunPromoCodeSchema),
	searchResults: bokunObject,
	shoppingCart: bokunShoppingCartSchema,
	tax: bokunTaxSchema,
	taxes: pagedListSchema(bokunTaxSchema),
	text: bokunTextSchema,
	void: bokunVoidSchema,
} as const;

export { bokunObject, bokunObjectArray, bokunTextSchema, bokunVoidSchema };

export type BokunApiResponse = z.infer<typeof bokunApiResponseSchema>;
export type BokunAccommodation = z.infer<typeof bokunAccommodationSchema>;
export type BokunActivity = z.infer<typeof bokunActivitySchema>;
export type BokunBookingDetails = z.infer<typeof bokunBookingDetailsSchema>;
export type BokunShoppingCart = z.infer<typeof bokunShoppingCartSchema>;
export type BokunCheckoutResponse = z.infer<typeof bokunCheckoutResponseSchema>;
export type BokunStandardError = z.infer<typeof bokunStandardErrorSchema>;
export type BokunPricingCategory = z.infer<typeof bokunPricingCategorySchema>;
export type BokunPromoCode = z.infer<typeof bokunPromoCodeSchema>;
export type BokunTax = z.infer<typeof bokunTaxSchema>;
export type BokunCustomer = z.infer<typeof bokunCustomerSchema>;
export type BokunExperienceAvailability = z.infer<
	typeof bokunExperienceAvailabilitySchema
>;
