import { z } from "zod";

const idSchema = z.union([z.number(), z.string()]);
const nullableString = z.string().nullable().optional();
const numericString = z
	.string()
	.trim()
	.regex(/^-?\d+(?:\.\d+)?$/)
	.transform((value) => Number(value));
const nullableNumber = z
	.union([z.number(), numericString])
	.nullable()
	.optional();
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
/* Activity (v1) catalog schemas                                        */
/*                                                                      */
/* These type only the fields the activities experience consumes and    */
/* keep everything permissive (nullish, string-typed enums) so large,    */
/* drifting Bokun payloads never fail response validation. Semantic      */
/* narrowing (difficulty enum, duration buckets) happens in the core     */
/* `activities` domain mappers, not here.                                */
/* ------------------------------------------------------------------ */

const bokunDerivedPhotoSchema = z.looseObject({
	name: nullableString,
	url: nullableString,
});

export const bokunPhotoSchema = z.looseObject({
	id: idSchema.optional(),
	originalUrl: nullableString,
	alternateText: nullableString,
	description: nullableString,
	height: nullableNumber,
	width: nullableNumber,
	derived: z.array(bokunDerivedPhotoSchema).nullish(),
});

export const bokunSimpleMoneySchema = z.looseObject({
	amount: nullableNumber,
	currency: nullableString,
});

export const bokunLocationSchema = z.looseObject({
	country: nullableString,
	countryCode: nullableString,
	city: nullableString,
	latitude: nullableNumber,
	longitude: nullableNumber,
});

export const bokunActivityPricingCategorySchema = z.looseObject({
	id: idSchema,
	title: nullableString,
	fullTitle: nullableString,
	ticketCategory: nullableString,
	occupancy: nullableNumber,
	minAge: nullableNumber,
	maxAge: nullableNumber,
	ageQualified: nullableBoolean,
	defaultCategory: nullableBoolean,
});

export const bokunStartTimeSchema = z.looseObject({
	id: idSchema.optional(),
	label: nullableString,
	hour: nullableNumber,
	minute: nullableNumber,
	durationMinutes: nullableNumber,
	durationHours: nullableNumber,
	durationDays: nullableNumber,
	durationWeeks: nullableNumber,
});

export const bokunGuidanceSchema = z.looseObject({
	guidanceType: nullableString,
	languages: z.array(z.string()).nullish(),
});

export const bokunAgendaItemSchema = z.looseObject({
	id: idSchema.optional(),
	index: nullableNumber,
	title: nullableString,
	excerpt: nullableString,
	body: nullableString,
	day: nullableNumber,
	keyPhoto: bokunPhotoSchema.nullish(),
});

export const bokunGooglePlaceSchema = z.looseObject({
	country: nullableString,
	countryCode: nullableString,
	city: nullableString,
	cityCode: nullableString,
	geoLocationCenter: z
		.looseObject({ lat: nullableNumber, lng: nullableNumber })
		.nullish(),
});

export const bokunActivityDetailSchema = z.looseObject({
	id: idSchema.optional(),
	externalId: nullableString,
	published: nullableBoolean,
	slug: nullableString,
	title: nullableString,
	description: nullableString,
	excerpt: nullableString,
	keyPhoto: bokunPhotoSchema.nullish(),
	photos: z.array(bokunPhotoSchema).nullish(),
	languages: z.array(z.string()).nullish(),
	baseLanguage: nullableString,
	activityType: nullableString,
	bookingType: nullableString,
	scheduleType: nullableString,
	capacityType: nullableString,
	meetingType: nullableString,
	difficultyLevel: nullableString,
	minAge: nullableNumber,
	durationText: nullableString,
	durationMinutes: nullableNumber,
	durationHours: nullableNumber,
	durationDays: nullableNumber,
	durationWeeks: nullableNumber,
	reviewRating: nullableNumber,
	reviewCount: nullableNumber,
	nextDefaultPrice: nullableNumber,
	nextDefaultPriceMoney: bokunSimpleMoneySchema.nullish(),
	nextDefaultPriceAsText: nullableString,
	activityCategories: z.array(z.string()).nullish(),
	activityAttributes: z.array(z.string()).nullish(),
	guidanceTypes: z.array(bokunGuidanceSchema).nullish(),
	pricingCategories: z.array(bokunActivityPricingCategorySchema).nullish(),
	startTimes: z.array(bokunStartTimeSchema).nullish(),
	included: nullableString,
	excluded: nullableString,
	requirements: nullableString,
	attention: nullableString,
	agendaItems: z.array(bokunAgendaItemSchema).nullish(),
	googlePlace: bokunGooglePlaceSchema.nullish(),
});

export const bokunSearchResultItemSchema = z.looseObject({
	id: idSchema.optional(),
	title: nullableString,
	excerpt: nullableString,
	summary: nullableString,
	slug: nullableString,
	price: nullableNumber,
	keyPhoto: bokunPhotoSchema.nullish(),
	photos: z.array(bokunPhotoSchema).nullish(),
	languages: z.array(z.string()).nullish(),
	keywords: z.array(z.string()).nullish(),
	flags: z.array(z.string()).nullish(),
	location: bokunLocationSchema.nullish(),
});

export const bokunSearchResultsSchema = z.looseObject({
	items: z.array(bokunSearchResultItemSchema).default([]),
	totalHits: nullableNumber,
});

export const bokunActivityRateSchema = z.looseObject({
	id: idSchema.optional(),
	title: nullableString,
	description: nullableString,
	index: nullableNumber,
	pricedPerPerson: nullableBoolean,
	minPerBooking: nullableNumber,
	maxPerBooking: nullableNumber,
	allPricingCategories: nullableBoolean,
	pricingCategoryIds: z.array(idSchema).nullish(),
});

/**
 * One `pricePerCategoryUnit` row: the per-unit price for a pricing category when
 * the booking's participant count for that category falls inside
 * `[minParticipantsRequired, maxParticipantsRequired]` (group-size tiers).
 */
export const bokunRateCategoryPriceSchema = z.looseObject({
	id: idSchema,
	amount: bokunSimpleMoneySchema.nullish(),
	minParticipantsRequired: nullableNumber,
	maxParticipantsRequired: nullableNumber,
});

export const bokunRatePricesSchema = z.looseObject({
	activityRateId: idSchema.optional(),
	pricePerBooking: bokunSimpleMoneySchema.nullish(),
	pricePerCategoryUnit: z.array(bokunRateCategoryPriceSchema).nullish(),
});

/**
 * One departure (start time on a date). Live prices are carried in
 * `pricesByRate` (joined to `rates` on `activityRateId`); the flat
 * `pricesByCategory`/`defaultPrice` fields come back empty on this endpoint.
 */
export const bokunActivityAvailabilitySchema = z.looseObject({
	id: nullableString,
	activityId: idSchema.optional(),
	activityTitle: nullableString,
	startTime: nullableString,
	startTimeId: idSchema.optional(),
	startTimeLabel: nullableString,
	flexible: nullableBoolean,
	date: nullableNumber,
	localizedDate: nullableString,
	availabilityCount: nullableNumber,
	minParticipants: nullableNumber,
	minParticipantsToBookNow: nullableNumber,
	unlimitedAvailability: nullableBoolean,
	soldOut: nullableBoolean,
	unavailable: nullableBoolean,
	guidedLanguages: z.array(z.string()).nullish(),
	defaultRateId: nullableNumber,
	defaultPrice: nullableNumber,
	pricesByCategory: z.record(z.string(), z.number()).nullish(),
	pricesByRate: z.array(bokunRatePricesSchema).nullish(),
	rates: z.array(bokunActivityRateSchema).nullish(),
	flags: z.array(z.string()).nullish(),
});

/* ------------------------------------------------------------------ */
/* Registry consumed by the client                                     */
/* ------------------------------------------------------------------ */

export const bokunSchemas = {
	accommodation: bokunAccommodationSchema,
	activity: bokunActivityDetailSchema,
	activityArray: z.array(bokunActivityDetailSchema),
	activityAvailabilities: z.array(bokunActivityAvailabilitySchema),
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
	searchResults: bokunSearchResultsSchema,
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
export type BokunPhoto = z.infer<typeof bokunPhotoSchema>;
export type BokunSimpleMoney = z.infer<typeof bokunSimpleMoneySchema>;
export type BokunLocation = z.infer<typeof bokunLocationSchema>;
export type BokunActivityPricingCategory = z.infer<
	typeof bokunActivityPricingCategorySchema
>;
export type BokunStartTime = z.infer<typeof bokunStartTimeSchema>;
export type BokunGuidance = z.infer<typeof bokunGuidanceSchema>;
export type BokunAgendaItem = z.infer<typeof bokunAgendaItemSchema>;
export type BokunActivityDetail = z.infer<typeof bokunActivityDetailSchema>;
export type BokunSearchResultItem = z.infer<typeof bokunSearchResultItemSchema>;
export type BokunSearchResults = z.infer<typeof bokunSearchResultsSchema>;
export type BokunActivityRate = z.infer<typeof bokunActivityRateSchema>;
export type BokunRateCategoryPrice = z.infer<
	typeof bokunRateCategoryPriceSchema
>;
export type BokunRatePrices = z.infer<typeof bokunRatePricesSchema>;
export type BokunActivityAvailability = z.infer<
	typeof bokunActivityAvailabilitySchema
>;
