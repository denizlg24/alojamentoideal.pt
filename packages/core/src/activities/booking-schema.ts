/**
 * Normalizes Bokun's checkout booking-question metadata into the typed schema
 * the checkout UI renders and validates against. Bokun rejects a
 * `RESERVE_FOR_EXTERNAL_PAYMENT` direct booking that omits a required answer or a
 * preselected pickup/dropoff place, so the guest must supply exactly these
 * fields before payment. Kept pure (no network) so it can be unit-tested against
 * captured provider payloads; the live fetch lives in the web app.
 */

/** Bokun's rate-level pickup/dropoff selection modes. */
export type ActivityPlaceSelectionType =
	| "NOT_INCLUDED"
	| "PRESELECTED"
	| "SELECTED_BY_CUSTOMER";

export interface ActivityQuestionOption {
	label: string;
	value: string;
}

/** One Bokun booking question rendered as a single form field. */
export interface ActivityQuestionField {
	/** e.g. EMAIL_ADDRESS, PHONE_NUMBER, COUNTRY, LANGUAGE. */
	dataFormat: string | null;
	/** SHORT_TEXT, LONG_TEXT, DATE, BOOLEAN, CHECKBOX_TOGGLE, ... */
	dataType: string;
	label: string;
	options: ActivityQuestionOption[];
	questionId: string;
	/** Required to place the reservation (not merely before departure). */
	required: boolean;
	selectFromOptions: boolean;
	selectMultiple: boolean;
}

export interface ActivityPassengerQuestions {
	fields: ActivityQuestionField[];
	pricingCategoryId: number;
	title: string | null;
	type: string | null;
}

export interface ActivityPlaceOption {
	askForRoomNumber: boolean;
	id: string;
	title: string;
}

export interface ActivityPickupSchema {
	/** The guest chooses a place (SELECTED_BY_CUSTOMER) vs a fixed one. */
	customerSelectable: boolean;
	places: ActivityPlaceOption[];
	/** Bokun requires a place id on the booking. */
	required: boolean;
	roomNumberField: ActivityQuestionField | null;
}

export interface ActivityBookingSchema {
	activityId: string;
	activityQuestions: ActivityQuestionField[];
	dropoff: ActivityPickupSchema | null;
	mainContactFields: ActivityQuestionField[];
	passengers: ActivityPassengerQuestions[];
	pickup: ActivityPickupSchema | null;
}

export interface NormalizeActivityBookingSchemaInput {
	activityId: string;
	dropoffPlaces?: unknown;
	dropoffSelectionType?: string | null;
	/** Raw `checkout.optionsForBookingRequest` response. */
	options: unknown;
	pickupPlaces?: unknown;
	pickupSelectionType?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number") {
		return String(value);
	}
	return null;
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function parseOptions(raw: unknown): ActivityQuestionOption[] {
	const options: ActivityQuestionOption[] = [];
	for (const entry of asArray(raw)) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const value = asString(record.value);
		if (value === null) {
			continue;
		}
		options.push({ label: asString(record.label) ?? value, value });
	}
	return options;
}

function parseQuestion(raw: unknown): ActivityQuestionField | null {
	const record = asRecord(raw);
	if (!record) {
		return null;
	}
	const questionId = asString(record.questionId);
	if (questionId === null) {
		return null;
	}
	return {
		dataFormat: asString(record.dataFormat),
		dataType: asString(record.dataType) ?? "SHORT_TEXT",
		label: asString(record.label) ?? questionId,
		options: parseOptions(record.answerOptions),
		questionId,
		required: asBoolean(record.required),
		selectFromOptions: asBoolean(record.selectFromOptions),
		selectMultiple: asBoolean(record.selectMultiple),
	};
}

function parseQuestions(raw: unknown): ActivityQuestionField[] {
	const fields: ActivityQuestionField[] = [];
	for (const entry of asArray(raw)) {
		const field = parseQuestion(entry);
		if (field) {
			fields.push(field);
		}
	}
	return fields;
}

function parsePlaces(raw: unknown, key: string): ActivityPlaceOption[] {
	const container = asRecord(raw);
	const list = container ? asArray(container[key]) : asArray(raw);
	const places: ActivityPlaceOption[] = [];
	for (const entry of list) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const id = asString(record.id);
		if (id === null) {
			continue;
		}
		places.push({
			askForRoomNumber: asBoolean(record.askForRoomNumber),
			id,
			title: asString(record.title) ?? id,
		});
	}
	return places;
}

function normalizeSelectionType(
	value: string | null | undefined,
): ActivityPlaceSelectionType | null {
	const upper = value?.trim().toUpperCase();
	if (upper === "PRESELECTED") {
		return "PRESELECTED";
	}
	if (upper === "SELECTED_BY_CUSTOMER") {
		return "SELECTED_BY_CUSTOMER";
	}
	return null;
}

function buildPlaceSchema(
	selectionType: ActivityPlaceSelectionType | null,
	places: ActivityPlaceOption[],
	roomNumberField: ActivityQuestionField | null,
): ActivityPickupSchema | null {
	if (selectionType === null) {
		return null;
	}
	return {
		customerSelectable: selectionType === "SELECTED_BY_CUSTOMER",
		places,
		required: true,
		roomNumberField,
	};
}

/**
 * Turns Bokun's `optionsForBookingRequest` questions, the pickup/dropoff place
 * lists and the rate's selection types into the checkout schema. Pickup/dropoff
 * are surfaced only when the rate mandates a place (PRESELECTED or
 * SELECTED_BY_CUSTOMER); a PRESELECTED place is resolved server-side so the
 * guest is never asked.
 */
export function normalizeActivityBookingSchema(
	input: NormalizeActivityBookingSchemaInput,
): ActivityBookingSchema {
	const options = asRecord(input.options);
	const questions = asRecord(options?.questions);
	const firstBooking = asRecord(asArray(questions?.activityBookings)[0]);

	const passengers: ActivityPassengerQuestions[] = [];
	for (const entry of asArray(firstBooking?.passengers)) {
		const record = asRecord(entry);
		const pricingCategoryId = record
			? asString(record.pricingCategoryId)
			: null;
		if (!record || pricingCategoryId === null) {
			continue;
		}
		passengers.push({
			fields: parseQuestions(record.passengerDetails),
			pricingCategoryId: Number(pricingCategoryId),
			title: asString(record.pricingCategoryTitle),
			type: asString(record.pricingCategoryType),
		});
	}

	const pickupRoomNumber =
		parseQuestions(firstBooking?.pickupQuestions).find(
			(field) => field.questionId === "roomNumber",
		) ?? null;

	return {
		activityId: input.activityId,
		activityQuestions: parseQuestions(firstBooking?.questions),
		dropoff: buildPlaceSchema(
			normalizeSelectionType(input.dropoffSelectionType),
			parsePlaces(input.dropoffPlaces, "dropoffPlaces"),
			null,
		),
		mainContactFields: parseQuestions(questions?.mainContactDetails),
		passengers,
		pickup: buildPlaceSchema(
			normalizeSelectionType(input.pickupSelectionType),
			parsePlaces(input.pickupPlaces, "pickupPlaces"),
			pickupRoomNumber,
		),
	};
}
