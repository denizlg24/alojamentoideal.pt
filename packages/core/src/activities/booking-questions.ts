/**
 * Normalizes Bokun's post-booking questions payload
 * (`GET /question.json/booking/{parentBookingId}`) into a typed snapshot the
 * order hub renders, and serializes edited answers back into the DTO
 * `POST /question.json/booking/{parentBookingId}` expects. Unlike the checkout
 * booking schema (which only surfaces answers Bokun requires to place the
 * reservation), the post-booking payload carries every question — optional
 * ones included — together with the answers already on file. Kept pure (no
 * network) so it can be unit-tested against captured provider payloads; the
 * live fetch lives in the web app.
 */

import type { ActivityQuestionField } from "./booking-schema";
import {
	asArray,
	asRecord,
	asString,
	parseQuestion as parseQuestionField,
} from "./parsing";

/** A question as it exists on a placed booking: the field plus its answers. */
export interface ActivityAnsweredQuestion extends ActivityQuestionField {
	answers: string[];
}

export interface ActivityBookingPassengerQuestions {
	/** Bokun's per-passenger booking id; keys answer updates for this passenger. */
	bookingId: string | null;
	passengerDetails: ActivityAnsweredQuestion[];
	pricingCategoryId: number | null;
	questions: ActivityAnsweredQuestion[];
	title: string | null;
}

export interface ActivityBookingQuestionGroup {
	activityId: string | null;
	/** Bokun's activity-booking id inside the parent booking. */
	bookingId: string | null;
	passengers: ActivityBookingPassengerQuestions[];
	pickupQuestions: ActivityAnsweredQuestion[];
	questions: ActivityAnsweredQuestion[];
	title: string | null;
}

export interface ActivityBookingQuestionsSnapshot {
	activityBookings: ActivityBookingQuestionGroup[];
	mainContactDetails: ActivityAnsweredQuestion[];
}

/** Where an updated answer lands in the answer DTO. */
export type BookingQuestionAnswerGroup =
	| "activity"
	| "mainContact"
	| "passengerDetails"
	| "passengerQuestions"
	| "pickup";

export interface BookingQuestionAnswerUpdate {
	group: BookingQuestionAnswerGroup;
	/** Required for the two passenger groups; ignored otherwise. */
	passengerBookingId?: string | null;
	questionId: string;
	values: string[];
}

export interface BookingQuestionsCompleteness {
	missingOptional: number;
	missingRequired: number;
}

function parseAnswers(raw: unknown): string[] {
	const answers: string[] = [];
	for (const entry of asArray(raw)) {
		if (typeof entry === "string") {
			answers.push(entry);
		} else if (typeof entry === "number") {
			answers.push(String(entry));
		}
	}
	return answers;
}

function parseAnsweredQuestion(raw: unknown): ActivityAnsweredQuestion | null {
	const field = parseQuestionField(raw);
	if (!field) {
		return null;
	}
	const record = asRecord(raw);
	return {
		...field,
		answers: parseAnswers(record?.answers),
	};
}

function parseQuestions(raw: unknown): ActivityAnsweredQuestion[] {
	const fields: ActivityAnsweredQuestion[] = [];
	for (const entry of asArray(raw)) {
		const field = parseAnsweredQuestion(entry);
		if (field) {
			fields.push(field);
		}
	}
	return fields;
}

function parsePassenger(
	raw: unknown,
): ActivityBookingPassengerQuestions | null {
	const record = asRecord(raw);
	if (!record) {
		return null;
	}
	const pricingCategoryId = asString(record.pricingCategoryId);
	return {
		bookingId: asString(record.bookingId),
		passengerDetails: parseQuestions(record.passengerDetails),
		pricingCategoryId:
			pricingCategoryId === null ? null : Number(pricingCategoryId),
		questions: parseQuestions(record.questions),
		title: asString(record.pricingCategoryTitle),
	};
}

export function normalizeActivityBookingQuestions(
	raw: unknown,
): ActivityBookingQuestionsSnapshot {
	const payload = asRecord(raw);
	const activityBookings: ActivityBookingQuestionGroup[] = [];
	for (const entry of asArray(payload?.activityBookings)) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const passengers: ActivityBookingPassengerQuestions[] = [];
		for (const passengerRaw of asArray(record.passengers)) {
			const passenger = parsePassenger(passengerRaw);
			if (passenger) {
				passengers.push(passenger);
			}
		}
		activityBookings.push({
			activityId: asString(record.activityId),
			bookingId: asString(record.bookingId),
			passengers,
			pickupQuestions: parseQuestions(record.pickupQuestions),
			questions: parseQuestions(record.questions),
			title: asString(record.activityTitle),
		});
	}
	return {
		activityBookings,
		mainContactDetails: parseQuestions(payload?.mainContactDetails),
	};
}

function hasAnswer(question: ActivityAnsweredQuestion): boolean {
	return question.answers.some((answer) => answer.trim().length > 0);
}

function eachQuestion(
	snapshot: ActivityBookingQuestionsSnapshot,
	visit: (question: ActivityAnsweredQuestion) => void,
): void {
	for (const question of snapshot.mainContactDetails) {
		visit(question);
	}
	for (const booking of snapshot.activityBookings) {
		for (const question of booking.questions) {
			visit(question);
		}
		for (const question of booking.pickupQuestions) {
			visit(question);
		}
		for (const passenger of booking.passengers) {
			for (const question of passenger.passengerDetails) {
				visit(question);
			}
			for (const question of passenger.questions) {
				visit(question);
			}
		}
	}
}

/** Counts questions still without a non-blank answer, split by requiredness. */
export function summarizeBookingQuestionsCompleteness(
	snapshot: ActivityBookingQuestionsSnapshot,
): BookingQuestionsCompleteness {
	let missingOptional = 0;
	let missingRequired = 0;
	eachQuestion(snapshot, (question) => {
		if (hasAnswer(question)) {
			return;
		}
		if (question.required) {
			missingRequired += 1;
		} else {
			missingOptional += 1;
		}
	});
	return { missingOptional, missingRequired };
}

function withUpdatedAnswers(
	questions: ActivityAnsweredQuestion[],
	updates: Map<string, string[]>,
): ActivityAnsweredQuestion[] {
	return questions.map((question) => {
		const values = updates.get(question.questionId);
		return values === undefined ? question : { ...question, answers: values };
	});
}

function updateKey(
	group: BookingQuestionAnswerGroup,
	passengerBookingId: string | null,
): string {
	return group === "passengerDetails" || group === "passengerQuestions"
		? `${group}::${passengerBookingId ?? "-"}`
		: group;
}

function bucketUpdates(
	updates: readonly BookingQuestionAnswerUpdate[],
): Map<string, Map<string, string[]>> {
	const buckets = new Map<string, Map<string, string[]>>();
	for (const update of updates) {
		const key = updateKey(update.group, update.passengerBookingId ?? null);
		const bucket = buckets.get(key) ?? new Map<string, string[]>();
		bucket.set(
			update.questionId,
			update.values.map((value) => value.trim()).filter((value) => value),
		);
		buckets.set(key, bucket);
	}
	return buckets;
}

const NO_UPDATES = new Map<string, string[]>();

/**
 * Returns a copy of the snapshot with the given answers applied. Unknown
 * question ids are ignored (the snapshot stays the provider's source of
 * truth); values are trimmed and blanks dropped, so submitting an empty value
 * clears the answer.
 */
export function applyBookingQuestionAnswers(
	snapshot: ActivityBookingQuestionsSnapshot,
	updates: readonly BookingQuestionAnswerUpdate[],
): ActivityBookingQuestionsSnapshot {
	const buckets = bucketUpdates(updates);
	const bucket = (key: string): Map<string, string[]> =>
		buckets.get(key) ?? NO_UPDATES;

	return {
		activityBookings: snapshot.activityBookings.map((booking) => ({
			...booking,
			passengers: booking.passengers.map((passenger) => ({
				...passenger,
				passengerDetails: withUpdatedAnswers(
					passenger.passengerDetails,
					bucket(updateKey("passengerDetails", passenger.bookingId)),
				),
				questions: withUpdatedAnswers(
					passenger.questions,
					bucket(updateKey("passengerQuestions", passenger.bookingId)),
				),
			})),
			pickupQuestions: withUpdatedAnswers(
				booking.pickupQuestions,
				bucket("pickup"),
			),
			questions: withUpdatedAnswers(booking.questions, bucket("activity")),
		})),
		mainContactDetails: withUpdatedAnswers(
			snapshot.mainContactDetails,
			bucket("mainContact"),
		),
	};
}

function toAnswerDtos(
	questions: ActivityAnsweredQuestion[],
): { questionId: string; values: string[] }[] {
	return questions
		.filter((question) => hasAnswer(question))
		.map((question) => ({
			questionId: question.questionId,
			values: question.answers,
		}));
}

function toNumericId(value: string | null): number | string | null {
	if (value === null) {
		return null;
	}
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) ? numeric : value;
}

/**
 * Serializes the snapshot's current answers into the
 * `POST /question.json/booking/{parentBookingId}` body (the same DTO the
 * legacy app submits). Questions without an answer are omitted.
 */
export function buildBookingQuestionsAnswerBody(
	snapshot: ActivityBookingQuestionsSnapshot,
): Record<string, unknown> {
	return {
		activityBookings: snapshot.activityBookings.map((booking) => ({
			activityId: toNumericId(booking.activityId),
			answers: toAnswerDtos(booking.questions),
			bookingId: toNumericId(booking.bookingId),
			passengers: booking.passengers.map((passenger) => ({
				answers: toAnswerDtos(passenger.questions),
				bookingId: toNumericId(passenger.bookingId),
				passengerDetails: toAnswerDtos(passenger.passengerDetails),
				pricingCategoryId: passenger.pricingCategoryId,
			})),
			pickupAnswers: toAnswerDtos(booking.pickupQuestions),
		})),
		mainContactDetails: toAnswerDtos(snapshot.mainContactDetails),
	};
}
