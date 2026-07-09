import type {
	ActivityBookingSchema,
	ActivityPlaceOption,
	ActivityQuestionField,
} from "@workspace/core/activities";
import type {
	ActivityCartItemDto,
	DraftOrderActivityDetailInput,
} from "@workspace/core/commerce";

/**
 * Pure derivation of the checkout activity-questions form from a Bokun booking
 * schema. Kept UI-free so the React hook, the presentational form and the
 * completeness/submit logic all agree on which fields exist and how each answer
 * maps back to the `activityDetails` draft-order payload. Main-contact fields
 * already covered by the checkout contact form are filled server-side and never
 * re-asked; pickup/dropoff fields are rendered from the provider schema for the
 * selected place.
 */

const STANDARD_MAIN_CONTACT = new Set([
	"firstName",
	"lastName",
	"email",
	"phoneNumber",
]);

/** Answer groups mirror `reservations.ts` when it rebuilds the Bokun payload. */
export type ActivityAnswerGroup =
	| "mainContact"
	| "activity"
	| "dropoff"
	| "passenger"
	| "passengerDetails"
	| "pickup";

export interface ActivityQuestionEntry {
	/** Stable key into the draft's `answers` record. */
	key: string;
	group: ActivityAnswerGroup;
	participantIndex: number | null;
	questionId: string;
	field: ActivityQuestionField;
	required: boolean;
}

export interface ActivityPassengerGroup {
	label: string;
	participantIndex: number;
	questions: ActivityQuestionEntry[];
}

export interface ActivityPlacePrompt {
	/** The guest may describe their own pickup as free text (pickup only). */
	customAllowed: boolean;
	kind: "pickup" | "dropoff";
	label: string;
	/** The guest may decline the service; a null place id is a valid choice. */
	optional: boolean;
	places: ActivityPlaceOption[];
	/** Provider questions for the currently resolved place. */
	questions: ActivityQuestionField[];
	/** Backward-compatible pointer for places that advertise room numbers. */
	roomNumberField: ActivityQuestionField | null;
	/** The guest actively chooses (multiple options, or an optional service). */
	selectable: boolean;
	/** Resolved when the place is fixed or the only option; sent without asking. */
	autoPlaceId: string | null;
}

export interface ActivityBookingDescription {
	activityQuestions: ActivityQuestionEntry[];
	contactQuestions: ActivityQuestionEntry[];
	dropoff: ActivityPlacePrompt | null;
	/** True when the guest must supply anything at all (drives the card). */
	needsInput: boolean;
	passengers: ActivityPassengerGroup[];
	pickup: ActivityPlacePrompt | null;
}

export interface ActivityBookingDraft {
	answers: Record<string, string>;
	dropoffPlaceId: string | null;
	pickupPlaceId: string | null;
	roomNumber: string;
}

/**
 * Sentinel place id for "I want to specify my own pick-up" (legacy parity).
 * The guest skips the operator's places and describes their own pickup through
 * the provider's placeless pickup questions; the reservation goes out with
 * `pickup: false`, no place id and those answers. Never sent as a place id.
 */
export const CUSTOM_PICKUP_PLACE_ID = "custom";

export function emptyActivityDraft(): ActivityBookingDraft {
	return {
		answers: {},
		dropoffPlaceId: null,
		pickupPlaceId: null,
		roomNumber: "",
	};
}

export function isBooleanField(field: ActivityQuestionField): boolean {
	const type = field.dataType.toUpperCase();
	return type === "BOOLEAN" || type === "CHECKBOX_TOGGLE";
}

function answerKey(
	group: ActivityAnswerGroup,
	participantIndex: number | null,
	questionId: string,
): string {
	return `${group}::${participantIndex ?? "-"}::${questionId}`;
}

function toEntry(
	group: ActivityAnswerGroup,
	participantIndex: number | null,
	field: ActivityQuestionField,
	required = field.required,
): ActivityQuestionEntry {
	return {
		field,
		group,
		key: answerKey(group, participantIndex, field.questionId),
		participantIndex,
		questionId: field.questionId,
		required,
	};
}

function placePrompt(
	kind: "pickup" | "dropoff",
	schema: ActivityBookingSchema["pickup"],
): ActivityPlacePrompt | null {
	if (!schema) {
		return null;
	}
	const optional = !schema.required;
	if (optional && schema.places.length === 0) {
		return null;
	}
	// Bokun can mark pickup as PRESELECTED while still returning multiple valid
	// pickup places. The legacy app treats that as a guest choice.
	const hasPlaceChoice = optional || schema.places.length > 1;
	const selectable = hasPlaceChoice || schema.customAllowed;
	// A PRESELECTED single place stays the default even when custom pickup is
	// allowed (the guest may switch to their own); rates where the guest chooses
	// (SELECTED_BY_CUSTOMER) have no place default and fall back to custom.
	const autoPlaceId =
		hasPlaceChoice || (schema.customerSelectable && schema.customAllowed)
			? null
			: (schema.places[0]?.id ?? null);
	return {
		autoPlaceId,
		customAllowed: schema.customAllowed,
		kind,
		label: kind === "pickup" ? "Pickup location" : "Drop-off location",
		optional,
		places: schema.places,
		questions: schema.questions,
		roomNumberField: schema.roomNumberField,
		selectable,
	};
}

const FALLBACK_ROOM_NUMBER_FIELD = {
	dataFormat: null,
	dataType: "SHORT_TEXT",
	label: "Room number",
	options: [],
	questionId: "roomNumber",
	required: true,
	selectFromOptions: false,
	selectMultiple: false,
} satisfies ActivityQuestionField;

const FALLBACK_FLIGHT_NUMBER_FIELD = {
	dataFormat: null,
	dataType: "SHORT_TEXT",
	label: "Flight number",
	options: [],
	questionId: "flightNumber",
	required: true,
	selectFromOptions: false,
	selectMultiple: false,
} satisfies ActivityQuestionField;

const FALLBACK_ESTIMATED_ARRIVAL_FIELD = {
	dataFormat: "TIME",
	dataType: "SHORT_TEXT",
	label: "Estimated arrival",
	options: [],
	questionId: "estimatedArrival",
	required: true,
	selectFromOptions: false,
	selectMultiple: false,
} satisfies ActivityQuestionField;

/**
 * The one question a custom pickup asks. Its answer travels as a pickup-group
 * answer under the reserved `pickupDescription` id, which the reservation
 * builder lifts onto Bokun's `pickup:true + pickupDescription` wire fields.
 */
const CUSTOM_PICKUP_DESCRIPTION_FIELD = {
	dataFormat: null,
	dataType: "SHORT_TEXT",
	label: "Where should we pick you up?",
	options: [],
	questionId: "pickupDescription",
	required: true,
	selectFromOptions: false,
	selectMultiple: false,
} satisfies ActivityQuestionField;

function normalizedPlaceType(place: ActivityPlaceOption): string {
	return place.type?.trim().toUpperCase() ?? "";
}

function systemPlaceQuestions(
	prompt: ActivityPlacePrompt,
	place: ActivityPlaceOption,
): ActivityQuestionField[] {
	const type = normalizedPlaceType(place);
	if (type === "AIRPORT") {
		return [FALLBACK_FLIGHT_NUMBER_FIELD, FALLBACK_ESTIMATED_ARRIVAL_FIELD];
	}
	if (type === "ACCOMMODATION" || place.askForRoomNumber) {
		return [prompt.roomNumberField ?? FALLBACK_ROOM_NUMBER_FIELD];
	}
	return [];
}

export function placeDetailsPossible(
	prompt: ActivityPlacePrompt | null,
): boolean {
	return prompt
		? prompt.questions.length > 0 ||
				prompt.places.some(
					(place) => systemPlaceQuestions(prompt, place).length > 0,
				)
		: false;
}

/**
 * Flattens the schema into the exact set of required inputs the guest must
 * supply. Passengers are expanded in participant order so `participantIndex`
 * lines up with the reservation builder's per-passenger indexing.
 */
export function describeActivityBooking(
	item: ActivityCartItemDto,
	schema: ActivityBookingSchema,
): ActivityBookingDescription {
	const contactQuestions = schema.mainContactFields
		.filter(
			(field) => field.required && !STANDARD_MAIN_CONTACT.has(field.questionId),
		)
		.map((field) => toEntry("mainContact", null, field));

	const activityQuestions = schema.activityQuestions.map((field) =>
		toEntry("activity", null, field),
	);

	const fieldsByCategory = new Map<
		number,
		{ details: ActivityQuestionField[]; questions: ActivityQuestionField[] }
	>();
	for (const passenger of schema.passengers) {
		fieldsByCategory.set(passenger.pricingCategoryId, {
			details: passenger.fields,
			questions: passenger.questions,
		});
	}

	const passengers: ActivityPassengerGroup[] = [];
	let participantIndex = 0;
	for (const participant of item.participants) {
		for (let offset = 0; offset < participant.count; offset += 1) {
			const fields = fieldsByCategory.get(participant.pricingCategoryId) ?? {
				details: [],
				questions: [],
			};
			const entries = [
				...fields.details.map((field) =>
					toEntry("passengerDetails", participantIndex, field),
				),
				...fields.questions.map((field) =>
					toEntry("passenger", participantIndex, field),
				),
			];
			if (entries.length > 0) {
				const label =
					participant.count > 1
						? `${participant.label} ${offset + 1}`
						: participant.label;
				passengers.push({
					label,
					participantIndex,
					questions: entries,
				});
			}
			participantIndex += 1;
		}
	}

	const pickup = placePrompt("pickup", schema.pickup);
	const dropoff = placePrompt("dropoff", schema.dropoff);
	const pickupQuestionsPossible = placeDetailsPossible(pickup);
	const dropoffQuestionsPossible = placeDetailsPossible(dropoff);

	const needsInput =
		contactQuestions.length > 0 ||
		activityQuestions.length > 0 ||
		passengers.length > 0 ||
		(pickup?.selectable ?? false) ||
		(dropoff?.selectable ?? false) ||
		pickupQuestionsPossible ||
		dropoffQuestionsPossible;

	return {
		activityQuestions,
		contactQuestions,
		dropoff,
		needsInput,
		passengers,
		pickup,
	};
}

export function resolvePlaceId(
	prompt: ActivityPlacePrompt | null,
	chosen: string | null,
): string | null {
	if (!prompt) {
		return null;
	}
	if (chosen ?? prompt.autoPlaceId) {
		return chosen ?? prompt.autoPlaceId;
	}
	// A required pickup with no place default falls back to the guest specifying
	// their own (legacy parity); optional prompts default to declining.
	return prompt.customAllowed && !prompt.optional
		? CUSTOM_PICKUP_PLACE_ID
		: null;
}

export function placeAsksRoom(
	prompt: ActivityPlacePrompt | null,
	placeId: string | null,
): boolean {
	if (!prompt || !placeId) {
		return false;
	}
	return (
		prompt.places.find((place) => place.id === placeId)?.askForRoomNumber ??
		false
	);
}

function placeQuestionEntries(
	prompt: ActivityPlacePrompt | null,
	placeId: string | null,
): ActivityQuestionEntry[] {
	if (!prompt || !placeId) {
		return [];
	}
	if (placeId === CUSTOM_PICKUP_PLACE_ID) {
		// The guest describes their own pickup; no operator place, so place-bound
		// fields like the room number are dropped along with the system fields.
		return [
			toEntry(prompt.kind, null, CUSTOM_PICKUP_DESCRIPTION_FIELD),
			...prompt.questions
				.filter((field) => field.questionId !== "roomNumber")
				.map((field) => toEntry(prompt.kind, null, field)),
		];
	}
	const place = prompt.places.find((candidate) => candidate.id === placeId);
	if (!place) {
		return [];
	}
	const roomNumberRequired =
		normalizedPlaceType(place) === "ACCOMMODATION" || place.askForRoomNumber;
	const hasRoomNumber = prompt.questions.some(
		(field) => field.questionId === "roomNumber",
	);
	const providerQuestionIds = new Set(
		prompt.questions.map((field) => field.questionId),
	);
	const questions = [
		...prompt.questions,
		...systemPlaceQuestions(prompt, place).filter(
			(field) => !providerQuestionIds.has(field.questionId),
		),
	];
	const entries = questions.map((field) =>
		toEntry(
			prompt.kind,
			null,
			field,
			field.required ||
				(roomNumberRequired && field.questionId === "roomNumber"),
		),
	);
	if (roomNumberRequired && !hasRoomNumber) {
		const hasFallbackRoomNumber = entries.some(
			(entry) => entry.questionId === "roomNumber",
		);
		if (!hasFallbackRoomNumber) {
			entries.unshift(
				toEntry(
					prompt.kind,
					null,
					prompt.roomNumberField ?? FALLBACK_ROOM_NUMBER_FIELD,
					true,
				),
			);
		}
	}
	return entries;
}

export function activePickupQuestions(
	desc: ActivityBookingDescription,
	draft: ActivityBookingDraft,
): ActivityQuestionEntry[] {
	return placeQuestionEntries(
		desc.pickup,
		resolvePlaceId(desc.pickup, draft.pickupPlaceId),
	);
}

export function activeDropoffQuestions(
	desc: ActivityBookingDescription,
	draft: ActivityBookingDraft,
): ActivityQuestionEntry[] {
	return placeQuestionEntries(
		desc.dropoff,
		resolvePlaceId(desc.dropoff, draft.dropoffPlaceId),
	);
}

function allQuestions(
	desc: ActivityBookingDescription,
	draft: ActivityBookingDraft,
): ActivityQuestionEntry[] {
	return [
		...desc.contactQuestions,
		...desc.activityQuestions,
		...desc.passengers.flatMap((group) => group.questions),
		...activePickupQuestions(desc, draft),
		...activeDropoffQuestions(desc, draft),
	];
}

function isAnswered(
	entry: ActivityQuestionEntry,
	draft: ActivityBookingDraft,
): boolean {
	if (!entry.required) {
		return true;
	}
	const value = draft.answers[entry.key] ?? "";
	if (isBooleanField(entry.field)) {
		return value === "true";
	}
	return value.trim().length > 0;
}

/** Whether every required field/place for this item has been supplied. */
export function isActivityDetailComplete(
	desc: ActivityBookingDescription,
	draft: ActivityBookingDraft,
): boolean {
	if (!allQuestions(desc, draft).every((entry) => isAnswered(entry, draft))) {
		return false;
	}
	const pickupId = resolvePlaceId(desc.pickup, draft.pickupPlaceId);
	if (desc.pickup?.selectable && !desc.pickup.optional && !pickupId) {
		return false;
	}
	if (
		desc.dropoff?.selectable &&
		!desc.dropoff.optional &&
		!resolvePlaceId(desc.dropoff, draft.dropoffPlaceId)
	) {
		return false;
	}
	return true;
}

/**
 * Serializes the collected answers/places into the draft-order activity detail
 * the checkout submit sends. Empty answers are dropped; a preselected or single
 * pickup/drop-off place rides along even when the guest was never asked.
 */
export function buildActivityDetailInput(
	cartItemId: string,
	desc: ActivityBookingDescription,
	draft: ActivityBookingDraft,
): DraftOrderActivityDetailInput {
	const activeQuestions = allQuestions(desc, draft);
	const answers = activeQuestions
		.map((entry) => ({ entry, value: (draft.answers[entry.key] ?? "").trim() }))
		.filter(({ entry, value }) =>
			isBooleanField(entry.field) ? value === "true" : value.length > 0,
		)
		.map(({ entry, value }) => ({
			answer: isBooleanField(entry.field) ? "true" : value,
			group: entry.group,
			participantIndex: entry.participantIndex,
			questionId: entry.questionId,
		}));

	const resolvedPickupId = resolvePlaceId(desc.pickup, draft.pickupPlaceId);
	// A custom pickup sends no place id; the guest's location rides as the
	// reserved `pickupDescription` answer and becomes `pickup:true +
	// pickupDescription` on the Bokun reserve.
	const pickupPlaceId =
		resolvedPickupId === CUSTOM_PICKUP_PLACE_ID ? null : resolvedPickupId;
	const dropoffPlaceId = resolvePlaceId(desc.dropoff, draft.dropoffPlaceId);
	const roomNumberAnswer = activePickupQuestions(desc, draft)
		.map((entry) =>
			entry.questionId === "roomNumber"
				? (draft.answers[entry.key] ?? "").trim()
				: "",
		)
		.find((value) => value.length > 0);
	const roomNumber =
		roomNumberAnswer ??
		(placeAsksRoom(desc.pickup, pickupPlaceId) && draft.roomNumber.trim()
			? draft.roomNumber.trim()
			: null);

	return { answers, cartItemId, dropoffPlaceId, pickupPlaceId, roomNumber };
}
