/**
 * Normalizes Bokun's checkout booking-question metadata into the typed schema
 * the checkout UI renders and validates against. Bokun rejects a
 * `RESERVE_FOR_EXTERNAL_PAYMENT` direct booking that omits a required answer or a
 * preselected pickup/dropoff place, so the guest must supply exactly these
 * fields before payment. Kept pure (no network) so it can be unit-tested against
 * captured provider payloads; the live fetch lives in the web app.
 */

import {
	asArray,
	asBoolean,
	asRecord,
	asString,
	parseQuestions,
} from "./parsing";

/** Bokun's rate-level pickup/dropoff selection modes. */
export type ActivityPlaceSelectionType =
	| "NOT_INCLUDED"
	| "OPTIONAL"
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
	/** Passenger identity/detail fields, sent as Bokun `passengerDetails`. */
	fields: ActivityQuestionField[];
	pricingCategoryId: number;
	/** Passenger booking questions, sent as Bokun passenger `answers`. */
	questions: ActivityQuestionField[];
	title: string | null;
	type: string | null;
}

export interface ActivityPlaceOption {
	askForRoomNumber: boolean;
	id: string;
	title: string;
	type: string | null;
}

export interface ActivityPickupSchema {
	/** The guest chooses a place (SELECTED_BY_CUSTOMER) vs a fixed one. */
	customerSelectable: boolean;
	places: ActivityPlaceOption[];
	/** Provider questions that apply to the currently resolved place. */
	questions: ActivityQuestionField[];
	/** Bokun requires a place id on the booking. */
	required: boolean;
	/** Backward-compatible pointer for places that advertise room numbers. */
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
	/** Raw Bokun checkout options response. */
	options: unknown;
	pickupPlaces?: unknown;
	pickupSelectionType?: string | null;
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
			type: asString(record.type)?.toUpperCase() ?? null,
		});
	}
	return places;
}

function normalizeSelectionType(
	value: string | null | undefined,
): ActivityPlaceSelectionType | null {
	const upper = value?.trim().toUpperCase();
	if (upper === "OPTIONAL") {
		return "OPTIONAL";
	}
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
	questions: ActivityQuestionField[],
	roomNumberField: ActivityQuestionField | null,
): ActivityPickupSchema | null {
	if (selectionType === null) {
		return null;
	}
	return {
		customerSelectable:
			selectionType === "SELECTED_BY_CUSTOMER" || selectionType === "OPTIONAL",
		places,
		questions,
		required: selectionType !== "OPTIONAL",
		roomNumberField,
	};
}

/**
 * Turns Bokun checkout option questions, the pickup/dropoff place lists and the
 * rate's selection types into the checkout schema. Pickup/dropoff are surfaced
 * when the rate offers the service (OPTIONAL, PRESELECTED or
 * SELECTED_BY_CUSTOMER). A PRESELECTED place is resolved server-side so the
 * guest is never asked; OPTIONAL lets the guest pick a place or decline the
 * service entirely (`required: false`).
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
			questions: parseQuestions(record.questions),
			title: asString(record.pricingCategoryTitle),
			type: asString(record.pricingCategoryType),
		});
	}

	const pickupQuestions = parseQuestions(firstBooking?.pickupQuestions);
	const pickupRoomNumber =
		pickupQuestions.find((field) => field.questionId === "roomNumber") ?? null;
	const dropoffQuestions = parseQuestions(firstBooking?.dropoffQuestions);

	return {
		activityId: input.activityId,
		activityQuestions: parseQuestions(firstBooking?.questions),
		dropoff: buildPlaceSchema(
			normalizeSelectionType(input.dropoffSelectionType),
			parsePlaces(input.dropoffPlaces, "dropoffPlaces"),
			dropoffQuestions,
			null,
		),
		mainContactFields: parseQuestions(questions?.mainContactDetails),
		passengers,
		pickup: buildPlaceSchema(
			normalizeSelectionType(input.pickupSelectionType),
			parsePlaces(input.pickupPlaces, "pickupPlaces"),
			pickupQuestions,
			pickupRoomNumber,
		),
	};
}
