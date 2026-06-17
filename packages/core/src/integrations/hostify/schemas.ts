import { z } from "zod";

const idSchema = z.union([z.number(), z.string()]);
const nullableIdSchema = idSchema.nullable().optional();
const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().nullable().optional();
const successSchema = z.union([z.literal(true), z.literal("true")]);

const entitySchema = z.looseObject({
	id: idSchema,
});

export const hostifyCompanySchema = entitySchema.extend({
	address: nullableStringSchema,
	city: nullableStringSchema,
	email: nullableStringSchema,
	name: z.string().optional(),
	phone: nullableStringSchema,
	website: nullableStringSchema,
	zipcode: z.union([z.number(), z.string()]).nullable().optional(),
});

export const hostifyCounterpartySchema = entitySchema.extend({
	address: nullableStringSchema,
	city: nullableStringSchema,
	email: nullableStringSchema,
	name: z.string().optional(),
	phone: nullableStringSchema,
	tax_id: nullableStringSchema,
});

export const hostifyInvoiceSchema = entitySchema.extend({
	amount_gross: nullableNumberSchema,
	amount_net: nullableNumberSchema,
	amount_tax: nullableNumberSchema,
	company_id: nullableIdSchema,
	counterparty_id: nullableIdSchema,
	date: nullableStringSchema,
	external_details: nullableStringSchema,
	external_id: nullableIdSchema,
	external_status: nullableStringSchema,
	number: z.union([z.number(), z.string()]).nullable().optional(),
	status: nullableStringSchema,
	type: nullableStringSchema,
});

export const hostifyCalendarEntrySchema = entitySchema.extend({
	base_price: nullableNumberSchema,
	cta: z.number().nullable().optional(),
	ctd: z.number().nullable().optional(),
	currency: nullableStringSchema,
	date: z.string(),
	is_manual_blocked: z.number().nullable().optional(),
	is_preparation_blocked: z.number().nullable().optional(),
	listing_id: nullableIdSchema,
	min_stay: z.number().nullable().optional(),
	note: nullableStringSchema,
	price: nullableNumberSchema,
	reservation_id: nullableIdSchema,
	status: nullableStringSchema,
});

export const hostifyCustomStaySchema = entitySchema.extend({
	date_end: nullableStringSchema,
	date_start: nullableStringSchema,
	listing_id: nullableIdSchema,
	min_stay: z.number().nullable().optional(),
	name: nullableStringSchema,
});

export const hostifyCtaCtdRestrictionSchema = entitySchema.extend({
	cta: z
		.union([z.array(z.number()), z.string()])
		.nullable()
		.optional(),
	ctd: z
		.union([z.array(z.number()), z.string()])
		.nullable()
		.optional(),
	end_date: nullableStringSchema,
	listing_id: nullableIdSchema,
	start_date: nullableStringSchema,
});

export const hostifyGuestSchema = entitySchema.extend({
	email: nullableStringSchema,
	first_name: nullableStringSchema,
	last_name: nullableStringSchema,
	name: nullableStringSchema,
	phone: nullableStringSchema,
	thumb: nullableStringSchema,
});

export const hostifyAssigneeSchema = entitySchema.extend({
	avatar: nullableStringSchema,
	email: nullableStringSchema,
	first_name: nullableStringSchema,
	last_name: nullableStringSchema,
	name: nullableStringSchema,
});

export const hostifyMessageSchema = entitySchema.extend({
	avatar: nullableStringSchema,
	created: nullableStringSchema,
	guest_id: nullableIdSchema,
	guest_name: nullableStringSchema,
	guest_thumb: nullableStringSchema,
	is_automatic: z.number().nullable().optional(),
	message: nullableStringSchema,
	notes: nullableStringSchema,
});

export const hostifyThreadSchema = entitySchema.extend({
	answered: z.number().nullable().optional(),
	assignee: hostifyAssigneeSchema.nullable().optional(),
	assignee_id: nullableIdSchema,
	channel_thread_id: nullableIdSchema,
	channel_unread: z.number().nullable().optional(),
	guest_id: nullableIdSchema,
	guests: z.number().nullable().optional(),
	integration_id: nullableIdSchema,
	integration_type_id: nullableIdSchema,
	integration_type_name: nullableStringSchema,
	is_archived: z.number().nullable().optional(),
	last_message: nullableStringSchema,
	listing_id: nullableIdSchema,
	nights: z.number().nullable().optional(),
	preview: nullableStringSchema,
	reservation_id: nullableIdSchema,
	start_date: nullableStringSchema,
});

export const hostifyIntegrationSchema = entitySchema.extend({
	active: z.union([z.boolean(), z.number()]).nullable().optional(),
	name: nullableStringSchema,
	type: nullableStringSchema,
});

export const hostifyListingSchema = entitySchema.extend({
	active: z.union([z.boolean(), z.number()]).nullable().optional(),
	address: nullableStringSchema,
	bathrooms: nullableNumberSchema,
	bedrooms: nullableNumberSchema,
	city: nullableStringSchema,
	country: nullableStringSchema,
	currency: nullableStringSchema,
	description: nullableStringSchema,
	latitude: nullableNumberSchema,
	longitude: nullableNumberSchema,
	name: nullableStringSchema,
	nickname: nullableStringSchema,
	person_capacity: nullableNumberSchema,
	property_type: nullableStringSchema,
	state: nullableStringSchema,
	timezone: nullableStringSchema,
	zipcode: z.union([z.number(), z.string()]).nullable().optional(),
});

export const hostifyListingPriceSchema = z.looseObject({
	available: z.boolean(),
	channel_listing_id: nullableIdSchema,
	cleaning_fee: nullableNumberSchema,
	extra_person: nullableNumberSchema,
	extra_person_price: nullableNumberSchema,
	guests_included: nullableNumberSchema,
	nights: z.number(),
	person_capacity: nullableNumberSchema,
	position: nullableStringSchema,
	price: z.number(),
	price_markup: nullableNumberSchema,
	symbol: nullableStringSchema,
	total: z.number(),
	unicode: nullableStringSchema,
});

export const hostifyListingFeeSchema = entitySchema.extend({
	amount: nullableNumberSchema,
	fee_id: nullableIdSchema,
	is_percent: z.number().nullable().optional(),
	name: nullableStringSchema,
	type: nullableStringSchema,
});

export const hostifyListingPhotoSchema = entitySchema.extend({
	photo: z.string(),
	sort_order: z.number().optional(),
	thumbnail: nullableStringSchema,
});

export const hostifyListingTranslationSchema = z.looseObject({
	description: nullableStringSchema,
	language: z.string(),
	name: nullableStringSchema,
	notes: nullableStringSchema,
});

export const hostifyBookingRestrictionSchema = z.looseObject({
	max_stay: z.number().nullable().optional(),
	min_stay: z.number().nullable().optional(),
});

export const hostifyReservationFeeSchema = entitySchema.extend({
	amount_gross: nullableNumberSchema,
	amount_gross_total: nullableNumberSchema,
	amount_net: nullableNumberSchema,
	amount_tax: nullableNumberSchema,
	fee_id: nullableIdSchema,
	quantity: nullableNumberSchema,
});

export const hostifyReservationSchema = entitySchema.extend({
	adults: nullableNumberSchema,
	base_price: nullableNumberSchema,
	channel_commission: nullableNumberSchema,
	channel_reservation_id: nullableIdSchema,
	checkIn: nullableStringSchema,
	checkOut: nullableStringSchema,
	children: nullableNumberSchema,
	cleaning_fee: nullableNumberSchema,
	confirmation_code: nullableStringSchema,
	created_at: nullableStringSchema,
	currency: nullableStringSchema,
	extras_price: nullableNumberSchema,
	fees: z.array(hostifyReservationFeeSchema).optional(),
	guest_id: nullableIdSchema,
	guests: nullableNumberSchema,
	hostify_checkin_form_completed: z.number().nullable().optional(),
	hostify_checkin_form_link: nullableStringSchema,
	inbox_id: nullableIdSchema,
	infants: nullableNumberSchema,
	integration_id: nullableIdSchema,
	listing_id: nullableIdSchema,
	lock_link: nullableStringSchema,
	lock_pin: nullableStringSchema,
	nights: nullableNumberSchema,
	notes: nullableStringSchema,
	parent_listing_id: nullableIdSchema,
	payout_price: nullableNumberSchema,
	price_per_night: nullableNumberSchema,
	security_price: nullableNumberSchema,
	source: nullableStringSchema,
	status: nullableStringSchema,
	status_code: nullableNumberSchema,
	status_description: nullableStringSchema,
	subtotal: nullableNumberSchema,
	tax_amount: nullableNumberSchema,
	updated_at: nullableStringSchema,
});

export const hostifyWebhookSchema = entitySchema.extend({
	auth: nullableStringSchema,
	notification_type: nullableStringSchema,
	url: nullableStringSchema,
});

export const hostifyCustomFieldSchema = entitySchema.extend({
	name: nullableStringSchema,
	ref: nullableStringSchema,
	type: nullableStringSchema,
	value: nullableStringSchema,
});

export const hostifyPromotionSchema = entitySchema.extend({
	checkin_from: nullableStringSchema,
	checkin_till: nullableStringSchema,
	discount: nullableNumberSchema,
	discount_type: nullableStringSchema,
	is_active: z.number().nullable().optional(),
	name: nullableStringSchema,
	threshold_days: nullableNumberSchema,
	type: nullableStringSchema,
});

export const hostifyReviewSchema = entitySchema.extend({
	accuracy_rating: nullableNumberSchema,
	checkin_rating: nullableNumberSchema,
	clean_rating: nullableNumberSchema,
	comments: nullableStringSchema,
	communication_rating: nullableNumberSchema,
	created: nullableStringSchema,
	guest_id: nullableIdSchema,
	integration_id: nullableIdSchema,
	listing_id: nullableIdSchema,
	location_rating: nullableNumberSchema,
	rating: nullableNumberSchema,
	reservation_id: nullableIdSchema,
	value_rating: nullableNumberSchema,
});

export const hostifyTransactionTagSchema = entitySchema.extend({
	tag: z.string(),
});

export const hostifyTransactionSchema = entitySchema.extend({
	amount: nullableNumberSchema,
	arrival_date: nullableStringSchema,
	channel_transaction_id: nullableIdSchema,
	charge_date: nullableStringSchema,
	code: nullableStringSchema,
	currency: nullableStringSchema,
	details: nullableStringSchema,
	is_completed: z.number().nullable().optional(),
	notes: nullableStringSchema,
	payout_type: nullableNumberSchema,
	reservation_id: nullableIdSchema,
	source: nullableStringSchema,
	tags: z.array(hostifyTransactionTagSchema).optional(),
});

export const hostifyUserSchema = entitySchema.extend({
	active: z.union([z.boolean(), z.number()]).nullable().optional(),
	avatar: nullableStringSchema,
	email: nullableStringSchema,
	first_name: nullableStringSchema,
	last_name: nullableStringSchema,
	name: nullableStringSchema,
});

export const hostifyCheckinDataSchema = z.looseObject({
	adults: nullableNumberSchema,
	arrival: nullableStringSchema,
	children: nullableNumberSchema,
	completed_at: nullableStringSchema,
	departure: nullableStringSchema,
	fs_reservation_id: nullableIdSchema,
	id: idSchema,
	infants: nullableNumberSchema,
});

export const hostifyRentalAgreementSchema = z.looseObject({
	id: idSchema,
	rental_agreement_pdf: nullableStringSchema,
	reservation_id: nullableIdSchema,
	signature_raw: nullableStringSchema,
});

export const hostifyCheckinGuestSchema = entitySchema.extend({
	document_number: nullableStringSchema,
	document_type: nullableStringSchema,
	first_name: nullableStringSchema,
	last_name: nullableStringSchema,
	nationality: nullableStringSchema,
});

export const hostifyCheckinAttachmentSchema = entitySchema.extend({
	fs_reservations_checkin_guest_id: nullableIdSchema,
	image: nullableStringSchema,
	thumb: nullableStringSchema,
	type: nullableStringSchema,
});

export const hostifySuccessSchema = z.looseObject({
	success: successSchema,
});

export const hostifySchemas = {
	accessCodes: hostifySuccessSchema.extend({
		access_codes: z.looseObject({}).optional(),
	}),
	bookingRestriction: hostifySuccessSchema.extend({
		booking_restriction: hostifyBookingRestrictionSchema,
	}),
	calendar: hostifySuccessSchema.extend({
		calendar: z.array(hostifyCalendarEntrySchema),
		listing_id: idSchema,
	}),
	calendarEntry: hostifySuccessSchema.extend({
		calendar: hostifyCalendarEntrySchema,
		listing_id: idSchema,
	}),
	checkin: hostifySuccessSchema.extend({
		attachments: z.array(hostifyCheckinAttachmentSchema),
		checkin_data: hostifyCheckinDataSchema,
		guests: z.array(hostifyCheckinGuestSchema),
		rental_agreement: hostifyRentalAgreementSchema,
		reservation_uid: z.string(),
	}),
	companies: hostifySuccessSchema.extend({
		companies: z.array(hostifyCompanySchema),
	}),
	company: hostifySuccessSchema.extend({ company: hostifyCompanySchema }),
	counterparties: hostifySuccessSchema.extend({
		counterparties: z.array(hostifyCounterpartySchema),
	}),
	counterparty: hostifySuccessSchema.extend({
		counterparty: hostifyCounterpartySchema,
	}),
	ctaCtd: hostifySuccessSchema.extend({
		restrictions: z.array(hostifyCtaCtdRestrictionSchema),
	}),
	customField: hostifySuccessSchema.extend({
		custom_field: hostifyCustomFieldSchema,
	}),
	customFields: hostifySuccessSchema.extend({
		custom_fields: z.array(hostifyCustomFieldSchema),
	}),
	customStay: hostifySuccessSchema.extend({
		custom_stay: z.array(hostifyCustomStaySchema),
	}),
	guest: hostifySuccessSchema.extend({ guest: hostifyGuestSchema }),
	guests: hostifySuccessSchema.extend({ guests: z.array(hostifyGuestSchema) }),
	id: hostifySuccessSchema.extend({ id: idSchema }),
	integration: hostifySuccessSchema.extend({
		integration: hostifyIntegrationSchema,
	}),
	integrations: hostifySuccessSchema.extend({
		integrations: z.array(hostifyIntegrationSchema),
	}),
	invoice: hostifySuccessSchema.extend({ invoice: hostifyInvoiceSchema }),
	invoices: hostifySuccessSchema.extend({
		invoices: z.array(hostifyInvoiceSchema),
	}),
	listing: hostifySuccessSchema.extend({ listing: hostifyListingSchema }),
	listingFees: hostifySuccessSchema.extend({
		fees: z.array(hostifyListingFeeSchema),
	}),
	listingPhotos: hostifySuccessSchema.extend({
		photos: z.array(hostifyListingPhotoSchema),
	}),
	listingPrice: hostifySuccessSchema.extend({
		price: hostifyListingPriceSchema,
	}),
	listingStatus: hostifySuccessSchema.extend({
		status: z.looseObject({}),
	}),
	listingTranslations: hostifySuccessSchema.extend({
		translations: z.array(hostifyListingTranslationSchema),
	}),
	listings: hostifySuccessSchema.extend({
		listings: z.array(hostifyListingSchema),
	}),
	promotion: hostifySuccessSchema.extend({
		promotion: hostifyPromotionSchema,
	}),
	promotions: hostifySuccessSchema.extend({
		promotions: z.array(hostifyPromotionSchema),
	}),
	reservation: hostifySuccessSchema.extend({
		reservation: hostifyReservationSchema,
	}),
	reservationCustomFields: hostifySuccessSchema.extend({
		custom_fields: z.array(hostifyCustomFieldSchema),
	}),
	reservations: hostifySuccessSchema.extend({
		reservations: z.array(hostifyReservationSchema),
	}),
	review: hostifySuccessSchema.extend({ review: hostifyReviewSchema }),
	reviews: hostifySuccessSchema.extend({
		reviews: z.array(hostifyReviewSchema),
	}),
	search: hostifySuccessSchema.extend({
		results: z.array(z.looseObject({})).optional(),
	}),
	thread: hostifySuccessSchema.extend({
		messages: z.array(hostifyMessageSchema).optional(),
		thread: hostifyThreadSchema,
	}),
	threads: hostifySuccessSchema.extend({
		threads: z.array(hostifyThreadSchema),
	}),
	transaction: hostifySuccessSchema.extend({
		transaction: hostifyTransactionSchema,
	}),
	transactionTags: hostifySuccessSchema.extend({
		tags: z.array(hostifyTransactionTagSchema),
	}),
	transactions: hostifySuccessSchema.extend({
		transaction: z.array(hostifyTransactionSchema),
	}),
	user: hostifySuccessSchema.extend({ user: hostifyUserSchema }),
	users: hostifySuccessSchema.extend({ users: z.array(hostifyUserSchema) }),
	webhook: hostifySuccessSchema.extend({ webhook: hostifyWebhookSchema }),
	webhooks: hostifySuccessSchema.extend({
		webhooks: z.array(hostifyWebhookSchema),
	}),
} as const;

export type HostifyCalendarEntry = z.infer<typeof hostifyCalendarEntrySchema>;
export type HostifyCheckinDataResponse = z.infer<typeof hostifySchemas.checkin>;
export type HostifyCompany = z.infer<typeof hostifyCompanySchema>;
export type HostifyCounterparty = z.infer<typeof hostifyCounterpartySchema>;
export type HostifyCustomField = z.infer<typeof hostifyCustomFieldSchema>;
export type HostifyGuest = z.infer<typeof hostifyGuestSchema>;
export type HostifyIntegration = z.infer<typeof hostifyIntegrationSchema>;
export type HostifyInvoice = z.infer<typeof hostifyInvoiceSchema>;
export type HostifyListing = z.infer<typeof hostifyListingSchema>;
export type HostifyListingFee = z.infer<typeof hostifyListingFeeSchema>;
export type HostifyListingPhoto = z.infer<typeof hostifyListingPhotoSchema>;
export type HostifyListingPrice = z.infer<typeof hostifyListingPriceSchema>;
export type HostifyListingTranslation = z.infer<
	typeof hostifyListingTranslationSchema
>;
export type HostifyMessage = z.infer<typeof hostifyMessageSchema>;
export type HostifyPromotion = z.infer<typeof hostifyPromotionSchema>;
export type HostifyReservation = z.infer<typeof hostifyReservationSchema>;
export type HostifyReview = z.infer<typeof hostifyReviewSchema>;
export type HostifyThread = z.infer<typeof hostifyThreadSchema>;
export type HostifyTransaction = z.infer<typeof hostifyTransactionSchema>;
export type HostifyTransactionTag = z.infer<typeof hostifyTransactionTagSchema>;
export type HostifyUser = z.infer<typeof hostifyUserSchema>;
export type HostifyWebhook = z.infer<typeof hostifyWebhookSchema>;
