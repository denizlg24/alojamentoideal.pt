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
 * maps back to the `activityDetails` draft-order payload. Only Bokun-*required*
 * fields are surfaced (least friction); main-contact fields already covered by
 * the checkout contact form are filled server-side and never re-asked.
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
	| "passengerDetails";

export interface ActivityQuestionEntry {
	/** Stable key into the draft's `answers` record. */
	key: string;
	group: ActivityAnswerGroup;
	participantIndex: number | null;
	questionId: string;
	field: ActivityQuestionField;
}

export interface ActivityPassengerGroup {
	label: string;
	participantIndex: number;
	questions: ActivityQuestionEntry[];
}

export interface ActivityPlacePrompt {
	kind: "pickup" | "dropoff";
	label: string;
	/** The guest may decline the service; a null place id is a valid choice. */
	optional: boolean;
	places: ActivityPlaceOption[];
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
): ActivityQuestionEntry {
	return {
		field,
		group,
		key: answerKey(group, participantIndex, field.questionId),
		participantIndex,
		questionId: field.questionId,
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
	// An optional service is always a real choice (place vs none), even with a
	// single place on offer; a mandatory one only needs asking when ambiguous.
	const selectable =
		schema.customerSelectable && (schema.places.length > 1 || optional);
	return {
		autoPlaceId: selectable ? null : (schema.places[0]?.id ?? null),
		kind,
		label: kind === "pickup" ? "Pickup location" : "Drop-off location",
		optional,
		places: schema.places,
		selectable,
	};
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

	const activityQuestions = schema.activityQuestions
		.filter((field) => field.required)
		.map((field) => toEntry("activity", null, field));

	const fieldsByCategory = new Map<number, ActivityQuestionField[]>();
	for (const passenger of schema.passengers) {
		fieldsByCategory.set(
			passenger.pricingCategoryId,
			passenger.fields.filter((field) => field.required),
		);
	}

	const passengers: ActivityPassengerGroup[] = [];
	let participantIndex = 0;
	for (const participant of item.participants) {
		for (let offset = 0; offset < participant.count; offset += 1) {
			const fields = fieldsByCategory.get(participant.pricingCategoryId) ?? [];
			if (fields.length > 0) {
				const label =
					participant.count > 1
						? `${participant.label} ${offset + 1}`
						: participant.label;
				passengers.push({
					label,
					participantIndex,
					questions: fields.map((field) =>
						toEntry("passengerDetails", participantIndex, field),
					),
				});
			}
			participantIndex += 1;
		}
	}

	const pickup = placePrompt("pickup", schema.pickup);
	const dropoff = placePrompt("dropoff", schema.dropoff);
	const pickupRoomPossible = pickup
		? pickup.places.some((place) => place.askForRoomNumber)
		: false;

	const needsInput =
		contactQuestions.length > 0 ||
		activityQuestions.length > 0 ||
		passengers.length > 0 ||
		(pickup?.selectable ?? false) ||
		(dropoff?.selectable ?? false) ||
		pickupRoomPossible;

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
	return chosen ?? prompt.autoPlaceId;
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

function allQuestions(
	desc: ActivityBookingDescription,
): ActivityQuestionEntry[] {
	return [
		...desc.contactQuestions,
		...desc.activityQuestions,
		...desc.passengers.flatMap((group) => group.questions),
	];
}

function isAnswered(
	entry: ActivityQuestionEntry,
	draft: ActivityBookingDraft,
): boolean {
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
	if (!allQuestions(desc).every((entry) => isAnswered(entry, draft))) {
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
	if (
		placeAsksRoom(desc.pickup, pickupId) &&
		draft.roomNumber.trim().length === 0
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
	const answers = allQuestions(desc)
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

	const pickupPlaceId = resolvePlaceId(desc.pickup, draft.pickupPlaceId);
	const dropoffPlaceId = resolvePlaceId(desc.dropoff, draft.dropoffPlaceId);
	const roomNumber =
		placeAsksRoom(desc.pickup, pickupPlaceId) && draft.roomNumber.trim()
			? draft.roomNumber.trim()
			: null;

	return { answers, cartItemId, dropoffPlaceId, pickupPlaceId, roomNumber };
}
