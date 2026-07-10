import { randomUUID } from "node:crypto";
import type {
	ActivityBookingAnswerSnapshot,
	ActivityParticipantSnapshot,
} from "@workspace/db";
import type { BokunClient } from "../integrations/bokun";
import {
	BokunApiError,
	BokunNetworkError,
	type BokunRequestContext,
	BokunResponseValidationError,
	BokunTimeoutError,
} from "../integrations/bokun";
import type { HostifyClient } from "../integrations/hostify";
import {
	HostifyApiError,
	type HostifyCreateReservationInput,
	type HostifyCreateTransactionInput,
	HostifyNetworkError,
	type HostifyRequestContext,
	HostifyResponseValidationError,
	HostifyTimeoutError,
} from "../integrations/hostify";
import { logger } from "../observability";
import { minorUnitFactor } from "./money";

/**
 * Provider reservation gateway (Milestone M5 reserve-first saga).
 *
 * Two concerns live here, both provider-call only (no database): a pure mapper
 * that turns persisted order facts into a Hostify create-reservation payload,
 * and a provider-keyed gateway exposing the three idempotent hold operations the
 * `CommerceService` orchestrator drives. Keeping the database out of this module
 * lets the gateway be exercised against a fake Hostify client, and lets Bokun
 * slot in later by implementing the same `ProviderReservationGateway` interface
 * without touching the orchestrator.
 */

/** Stable marker embedded in a hold's note so a retry can re-discover it. */
const RESERVATION_TAG_PREFIX = "AI-REF";
const HOLD_LOOKUP_PAGE_SIZE = 50;

/** Hostify reservation statuses that mean the hold is no longer holding. */
const CANCELLED_PROVIDER_STATUSES: ReadonlySet<string> = new Set([
	"denied",
	"cancelled_by_host",
	"cancelled_by_guest",
	"no_show",
]);
const BOKUN_CONFIRMED_STATUSES: ReadonlySet<string> = new Set([
	"ARRIVED",
	"CONFIRMED",
]);
const BOKUN_HOLD_STATUSES: ReadonlySet<string> = new Set([
	"REQUESTED",
	"RESERVED",
]);
const BOKUN_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
	"ABORTED",
	"CANCELLED",
	"ERROR",
	"NO_SHOW",
	"REJECTED",
	"TIMEOUT",
]);

export interface ReservationContact {
	dateOfBirth?: string | null;
	email: string;
	firstName?: string | null;
	language?: string | null;
	lastName?: string | null;
	name: string;
	phone: string;
}

/** Minimal charge projection the money mapping needs (minor units). */
export interface ReservationChargeInput {
	grossMinor: number;
	kind: string;
	taxMinor: number;
}

export interface ReservationDetailInput {
	checkIn: string;
	checkOut: string;
	guests: number;
	hostifyListingId: string;
	pets: number;
}

export interface BuildReservationInput {
	charges: ReservationChargeInput[];
	/** `charge_date` for the transaction (YYYY-MM-DD); defaults to today (UTC). */
	chargeDate?: string;
	contact: ReservationContact;
	currency: string;
	detail: ReservationDetailInput;
	itemTotalMinor: number;
	orderItemId: string;
	publicReference: string;
	/** Hostify `source` channel tag; shared across all our direct holds. */
	source: string;
}

/**
 * A hold is two coupled Hostify writes: a `pending` reservation and an
 * `incomplete` accommodation transaction (the financial record). They are
 * created together and the reservation id links them; the transaction is
 * completed when the hold is confirmed and left incomplete when it is released.
 */
export interface HostifyHoldRequest {
	kind?: "hostify";
	reservation: HostifyCreateReservationInput;
	/** Transaction payload sans `reservation_id` (filled once the hold exists). */
	transaction: Omit<HostifyCreateTransactionInput, "reservation_id">;
}

export interface BokunActivityHoldRequest {
	activity: {
		activityDate: string;
		answers: ActivityBookingAnswerSnapshot[];
		bokunActivityId: string;
		/** Bokun dropoff place id; set when the rate requires a dropoff place. */
		dropoffPlaceId?: string | null;
		participants: ActivityParticipantSnapshot[];
		/** Bokun pickup place id; set when the rate requires a pickup place. */
		pickupPlaceId?: string | null;
		rateId: string | null;
		/** Free-text pickup room number, when the pickup place asks for one. */
		roomNumber?: string | null;
		startTimeId: string | null;
	};
	amountMinor: number;
	contact: ReservationContact;
	currency: string;
	kind: "bokun_activity";
	orderItemId: string;
	publicReference: string;
	source: string;
}

export type ProviderHoldRequest = BokunActivityHoldRequest | HostifyHoldRequest;

/** Deterministic dedupe tag for a hold (order reference + item). */
export function reservationTag(
	publicReference: string,
	orderItemId: string,
): string {
	return `${RESERVATION_TAG_PREFIX}:${publicReference}:${orderItemId}`;
}

function buildReservationNote(
	publicReference: string,
	orderItemId: string,
): string {
	return `Alojamento Ideal direct booking [${reservationTag(publicReference, orderItemId)}]`;
}

/** Converts integer minor units to the decimal major-unit number providers expect. */
function toProviderMoney(minor: number, currency: string): number {
	return minor / minorUnitFactor(currency);
}

function sumCharges(
	charges: ReservationChargeInput[],
	predicate: (charge: ReservationChargeInput) => boolean,
	pick: (charge: ReservationChargeInput) => number,
): number {
	return charges.reduce(
		(sum, charge) => (predicate(charge) ? sum + pick(charge) : sum),
		0,
	);
}

/**
 * Maps persisted order facts to a Hostify create-reservation payload for a
 * `pending` hold. Money is derived from the order's charge rows in minor units
 * and converted to Hostify's decimal major units. `fees[]` is intentionally
 * omitted: Hostify's `HostifyReservationFeeInput` requires a provider `fee_id`
 * we do not persist, and `total_price` is authoritative for a host-created
 * direct reservation. `base_price`/`tax_amount` are best-effort breakdowns.
 */
export function buildCreateReservationInput(
	input: BuildReservationInput,
): HostifyCreateReservationInput {
	const { charges, contact, currency, detail } = input;
	const basePriceMinor = sumCharges(
		charges,
		(charge) => charge.kind === "accommodation",
		(charge) => charge.grossMinor,
	);
	const taxMinor = sumCharges(
		charges,
		() => true,
		(charge) => charge.taxMinor,
	);

	return {
		base_price: toProviderMoney(basePriceMinor, currency),
		email: contact.email,
		end_date: detail.checkOut,
		guests: detail.guests,
		listing_id: detail.hostifyListingId,
		name: contact.name,
		note: buildReservationNote(input.publicReference, input.orderItemId),
		pets: detail.pets,
		phone: contact.phone,
		skip_restrictions: false,
		source: input.source,
		start_date: detail.checkIn,
		status: "pending",
		tax_amount: toProviderMoney(taxMinor, currency),
		total_price: toProviderMoney(input.itemTotalMinor, currency),
	};
}

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Maps order facts to the `incomplete` accommodation transaction created with a
 * hold. `reservation_id` is filled in by the gateway once the reservation
 * exists. Amount is the guest-charged total in Hostify major units.
 */
export function buildTransactionInput(
	input: BuildReservationInput,
): Omit<HostifyCreateTransactionInput, "reservation_id"> {
	return {
		amount: toProviderMoney(input.itemTotalMinor, input.currency),
		arrival_date: input.detail.checkIn,
		charge_date: input.chargeDate ?? todayUtc(),
		currency: input.currency.toUpperCase(),
		details: `Alojamento Ideal [${reservationTag(input.publicReference, input.orderItemId)}]`,
		is_completed: 0,
		type: "accommodation",
	};
}

/** Builds the coupled reservation + transaction payloads for one hold. */
export function buildHoldRequest(
	input: BuildReservationInput,
): HostifyHoldRequest {
	return {
		kind: "hostify",
		reservation: buildCreateReservationInput(input),
		transaction: buildTransactionInput(input),
	};
}

interface BokunAnswerDto {
	questionId: string;
	values: string[];
}

function toBokunAnswer(answer: ActivityBookingAnswerSnapshot): BokunAnswerDto {
	return { questionId: answer.questionId, values: [answer.answer] };
}

function answersForGroup(
	answers: ActivityBookingAnswerSnapshot[],
	group: string,
): BokunAnswerDto[] {
	return answers
		.filter((answer) => answer.participantIndex === null)
		.filter((answer) => answer.group === group)
		.map(toBokunAnswer);
}

function firstPassengerDetail(
	answers: ActivityBookingAnswerSnapshot[],
	questionId: string,
): string | null {
	const value = answers.find(
		(answer) =>
			answer.group === "passengerDetails" &&
			answer.participantIndex === 0 &&
			answer.questionId === questionId,
	)?.answer;
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function activityAnswers(
	answers: ActivityBookingAnswerSnapshot[],
): BokunAnswerDto[] {
	return answers
		.filter((answer) => answer.participantIndex === null)
		.filter(
			(answer) =>
				answer.group === "activity" ||
				(answer.group !== "mainContact" &&
					answer.group !== "pickup" &&
					answer.group !== "dropoff"),
		)
		.map(toBokunAnswer);
}

function passengerAnswers(
	answers: ActivityBookingAnswerSnapshot[],
	index: number,
	group: "passenger" | "passengerDetails",
): BokunAnswerDto[] {
	return answers
		.filter((answer) => answer.participantIndex === index)
		.filter((answer) => answer.group === group)
		.map(toBokunAnswer);
}

function buildPassengers(
	participants: ActivityParticipantSnapshot[],
	answers: ActivityBookingAnswerSnapshot[],
): Record<string, unknown>[] {
	const participantAnswers = answers.filter(
		(answer) => answer.participantIndex !== null,
	);
	if (participantAnswers.length === 0) {
		return participants
			.filter((participant) => participant.count > 0)
			.map((participant) => ({
				answers: [],
				extras: [],
				groupSize: participant.count,
				passengerDetails: [],
				pricingCategoryId: participant.pricingCategoryId,
			}));
	}

	const passengers: Record<string, unknown>[] = [];
	let participantIndex = 0;
	for (const participant of participants) {
		for (let offset = 0; offset < participant.count; offset += 1) {
			passengers.push({
				answers: passengerAnswers(answers, participantIndex, "passenger"),
				extras: [],
				groupSize: 1,
				passengerDetails: passengerAnswers(
					answers,
					participantIndex,
					"passengerDetails",
				),
				pricingCategoryId: participant.pricingCategoryId,
			});
			participantIndex += 1;
		}
	}
	return passengers;
}

type BokunActivityBookingInput = BokunActivityHoldRequest["activity"];

function contactFirstName(contact: ReservationContact): string {
	if (contact.firstName?.trim()) {
		return contact.firstName.trim();
	}
	const [first] = contact.name.trim().split(/\s+/);
	return first || contact.name;
}

function contactLastName(contact: ReservationContact): string | null {
	if (contact.lastName?.trim()) {
		return contact.lastName.trim();
	}
	const parts = contact.name.trim().split(/\s+/);
	return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

/**
 * Bokun requires `firstName`, `lastName`, `email`, `phoneNumber` and — for this
 * operator's activities — `language` and `dateOfBirth` on the main contact.
 * Custom main-contact questions ride along through the `mainContact` answer
 * group. Optional fields are omitted when absent rather than sent empty.
 */
function buildMainContactDetails(
	contact: ReservationContact,
	answers: ActivityBookingAnswerSnapshot[],
): BokunAnswerDto[] {
	const mainContactAnswers = answersForGroup(answers, "mainContact");
	const supplied = new Set(
		mainContactAnswers.map((answer) => answer.questionId),
	);
	const details: BokunAnswerDto[] = [...mainContactAnswers];

	const append = (questionId: string, value: string | null | undefined) => {
		const trimmed = value?.trim();
		if (!trimmed || supplied.has(questionId)) {
			return;
		}
		details.push({ questionId, values: [trimmed] });
		supplied.add(questionId);
	};

	append("firstName", contactFirstName(contact));
	append(
		"lastName",
		contact.lastName?.trim() ||
			contactLastName(contact) ||
			firstPassengerDetail(answers, "lastName"),
	);
	append("email", contact.email);
	append("phoneNumber", contact.phone);
	append(
		"language",
		contact.language?.trim() || firstPassengerDetail(answers, "language"),
	);
	append(
		"dateOfBirth",
		contact.dateOfBirth?.trim() || firstPassengerDetail(answers, "dateOfBirth"),
	);
	return details;
}

/**
 * Pickup fields for the activity booking. Bokun rejects a booking whose rate
 * preselects a pickup place unless `pickup:true` and the place id are sent, so a
 * resolved `pickupPlaceId` drives the flag. A pickup place that asks for a room
 * number carries it as a pickup answer. A guest-specified pickup travels as the
 * reserved `pickupDescription` answer and is lifted onto Bokun's custom-pickup
 * wire shape (`pickup:true + pickupDescription`, no place id).
 */
function pickupFields(
	activity: BokunActivityBookingInput,
): Record<string, unknown> {
	const groupAnswers = answersForGroup(activity.answers, "pickup");
	const pickupDescription =
		groupAnswers
			.find((answer) => answer.questionId === "pickupDescription")
			?.values.map((value) => value.trim())
			.find((value) => value.length > 0) ?? null;
	const pickupAnswers: BokunAnswerDto[] = groupAnswers.filter(
		(answer) => answer.questionId !== "pickupDescription",
	);
	const suppliedPickupQuestions = new Set(
		pickupAnswers.map((answer) => answer.questionId),
	);
	if (
		activity.roomNumber?.trim() &&
		!suppliedPickupQuestions.has("roomNumber")
	) {
		pickupAnswers.push({
			questionId: "roomNumber",
			values: [activity.roomNumber.trim()],
		});
	}
	if (activity.pickupPlaceId != null && String(activity.pickupPlaceId).trim()) {
		return {
			pickup: true,
			pickupAnswers,
			pickupPlaceId: Number(activity.pickupPlaceId),
		};
	}
	if (pickupDescription) {
		return { pickup: true, pickupAnswers, pickupDescription };
	}
	return { pickup: false, pickupAnswers };
}

function dropoffFields(
	activity: BokunActivityBookingInput,
): Record<string, unknown> {
	const dropoffAnswers = answersForGroup(activity.answers, "dropoff");
	if (
		activity.dropoffPlaceId != null &&
		String(activity.dropoffPlaceId).trim()
	) {
		return {
			dropoff: true,
			dropoffAnswers,
			dropoffPlaceId: Number(activity.dropoffPlaceId),
		};
	}
	return { dropoff: false, dropoffAnswers };
}

/**
 * Maps a persisted activity item into Bokun's direct checkout request. The
 * payment method reserves the booking for external payment; Stripe remains the
 * customer-facing payment processor.
 */
export function buildBokunActivityCheckoutRequest(
	input: BokunActivityHoldRequest,
): Record<string, unknown> {
	const { activity, contact } = input;
	return {
		amount: toProviderMoney(input.amountMinor, input.currency),
		checkoutOption: "CUSTOMER_FULL_PAYMENT",
		currency: input.currency.toUpperCase(),
		directBooking: {
			activityBookings: [
				{
					activityId: Number(activity.bokunActivityId),
					answers: activityAnswers(activity.answers),
					checkedIn: false,
					customized: false,
					date: activity.activityDate,
					note: buildReservationNote(input.publicReference, input.orderItemId),
					passengers: buildPassengers(activity.participants, activity.answers),
					...pickupFields(activity),
					...dropoffFields(activity),
					...(activity.rateId ? { rateId: Number(activity.rateId) } : {}),
					...(activity.startTimeId
						? { startTimeId: Number(activity.startTimeId) }
						: {}),
				},
			],
			externalBookingEntityCode: input.source,
			externalBookingEntityName: "Alojamento Ideal",
			externalBookingReference: reservationTag(
				input.publicReference,
				input.orderItemId,
			),
			mainContactDetails: buildMainContactDetails(contact, activity.answers),
		},
		paymentMethod: "RESERVE_FOR_EXTERNAL_PAYMENT",
		sendNotificationToMainContact: false,
		showPricesInNotification: true,
		source: "DIRECT_REQUEST",
	};
}

export interface PlacedHold {
	providerStatus: string | null;
	raw: Record<string, unknown>;
	reservationId: string;
	/** Hostify transaction id, or null when the financial record was not created. */
	transactionId: string | null;
}

export interface ConfirmHoldArgs {
	amountMinor?: number;
	currency?: string;
	/** Stripe payment reference recorded on the transaction detail. */
	paymentReference: string | null;
	publicReference?: string;
	reservationId: string;
	transactionId: string | null;
}

export interface CancelHoldArgs {
	reason: string;
	reservationId: string;
	transactionId: string | null;
}

export type PlaceHoldResult =
	| ({ kind: "created" } & PlacedHold)
	| { kind: "unavailable"; message: string }
	| { kind: "invalid"; message: string }
	| { code: string; kind: "transient"; message: string }
	| { code: string; kind: "permanent"; message: string };

/**
 * Outcome of a hold mutation that has reached a resolution the orchestrator can
 * act on: applied (`ok`), retryable call failure (`transient`), or a terminal
 * provider rejection (`permanent`). Shared by confirm and cancel.
 */
export type SettledMutateResult =
	| { kind: "ok"; providerStatus: string | null; raw: Record<string, unknown> }
	| { code: string; kind: "transient"; message: string }
	| { code: string; kind: "permanent"; message: string };

/**
 * A confirm outcome. Adds `not_settled` to {@link SettledMutateResult}: the
 * accept call returned but the provider has not applied it yet, leaving the hold
 * alive and `pending` (e.g. Hostify refuses to accept a reservation far in the
 * future and silently leaves it pending). Distinct from `transient` because it
 * must be retried *without* ever escalating to a refund. Only `confirmHold` can
 * produce it; cancel never does.
 */
export type MutateHoldResult =
	| SettledMutateResult
	| {
			kind: "not_settled";
			providerStatus: string | null;
			raw: Record<string, unknown>;
	  };

export interface FindHoldQuery {
	checkIn: string;
	checkOut: string;
	listingId: string;
	tag: string;
}

/**
 * Provider-call abstraction over a single accommodation hold (reservation +
 * financial transaction). All mutation operations are idempotent on the provider
 * side as far as the provider allows; the orchestrator additionally guards them
 * with persisted state.
 */
export interface ProviderReservationGateway {
	cancelHold(args: CancelHoldArgs): Promise<SettledMutateResult>;
	/** Cancels a settled reservation after payment, for operator item refunds. */
	cancelReservation(args: CancelHoldArgs): Promise<SettledMutateResult>;
	confirmHold(args: ConfirmHoldArgs): Promise<MutateHoldResult>;
	findExistingHold(query: FindHoldQuery): Promise<PlacedHold | null>;
	placeHold(request: ProviderHoldRequest): Promise<PlaceHoldResult>;
}

interface ClassifiedError {
	code: string;
	message: string;
	transient: boolean;
}

/**
 * Maps a thrown Hostify error to the transient/permanent split the saga needs.
 * Retryable transport (5xx/429/408/network/timeout) is transient; everything
 * else (validation, auth, not-found) is permanent. Availability is handled
 * separately by {@link HostifyReservationGateway.placeHold}.
 */
function classifyError(error: unknown): ClassifiedError {
	if (error instanceof HostifyApiError) {
		return {
			code: `http_${error.status}`,
			message: error.providerMessage ?? error.message,
			transient: error.retryable,
		};
	}
	if (
		error instanceof HostifyTimeoutError ||
		error instanceof HostifyNetworkError
	) {
		return { code: error.name, message: error.message, transient: true };
	}
	if (error instanceof HostifyResponseValidationError) {
		// Default classification is permanent: a read that cannot be parsed must
		// surface (e.g. hold lookup) rather than be mistaken for "no hold". The
		// confirm/cancel mutation paths override this to transient via
		// `toMutationFailure`, because there the same drift is ambiguous about
		// whether the change applied.
		const fields = error.issues.map((issue) => issue.path).join(", ");
		return {
			code: error.name,
			message: fields ? `${error.message} (fields: ${fields})` : error.message,
			transient: false,
		};
	}
	return {
		code: error instanceof Error ? error.name : "unknown_error",
		message: error instanceof Error ? error.message : String(error),
		transient: false,
	};
}

/**
 * Surfaces a provider response that failed schema validation, including the
 * exact failing fields and a PII-safe skeleton of the real body. A schema drift
 * on a mutation is otherwise invisible (the saga only persists a generic
 * message), and on `confirm` it can drive a wrongful refund, so it is logged at
 * the point the mutation is reported as failed.
 */
function logUnexpectedResponseShape(
	operation: string,
	reservationId: string,
	error: unknown,
): void {
	if (!(error instanceof HostifyResponseValidationError)) {
		return;
	}
	logger.error("Hostify reservation mutation returned an unexpected shape", {
		issues: error.issues,
		operation,
		requestId: error.requestId,
		reservationId,
		responseShape: error.responseShape,
	});
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
		: {};
}

interface HostifyReservationShape {
	id?: number | string | null;
	notes?: string | null;
	status?: string | null;
}

interface HostifyTransactionShape {
	details?: string | null;
	id?: number | string | null;
}

export interface HostifyReservationGatewayOptions {
	client: HostifyClient;
	context?: HostifyRequestContext;
}

/**
 * Hostify implementation of {@link ProviderReservationGateway}. A host-created
 * hold is a `status: "pending"` reservation; it is confirmed by updating its
 * status to `accepted` and released by updating to `cancelled_by_host`. The
 * inbox accept/decline endpoints are deliberately not used here: they act on
 * inquiry threads (`thread_id`), not on host-created reservation ids.
 */
export class HostifyReservationGateway implements ProviderReservationGateway {
	readonly #client: HostifyClient;
	readonly #context?: HostifyRequestContext;

	constructor(options: HostifyReservationGatewayOptions) {
		this.#client = options.client;
		this.#context = options.context;
	}

	async placeHold(request: ProviderHoldRequest): Promise<PlaceHoldResult> {
		if (request.kind === "bokun_activity") {
			return {
				code: "invalid_hold_request",
				kind: "permanent",
				message: "Hostify cannot place activity holds.",
			};
		}
		try {
			const response = await this.#client.reservations.create(
				request.reservation,
				this.#context,
			);
			const reservation = response.reservation as HostifyReservationShape;
			if (reservation.id === null || reservation.id === undefined) {
				return {
					code: "missing_reservation_id",
					kind: "permanent",
					message: "Hostify created a reservation without an id",
				};
			}
			const reservationId = String(reservation.id);
			// The financial transaction is created alongside the hold but is
			// accounting, not inventory: if it fails the reservation still holds, so
			// this is best-effort and never fails the hold.
			const transactionId = await this.#createHoldTransaction(
				reservationId,
				request.transaction,
			);
			return {
				kind: "created",
				providerStatus: reservation.status ?? null,
				raw: toRecord(response.reservation),
				reservationId,
				transactionId,
			};
		} catch (error) {
			// A non-retryable 409/422 from a `skip_restrictions:false` create means
			// the dates are blocked or violate a restriction: unavailable, never a
			// charge. Other non-retryable failures are permanent (auth/validation).
			if (
				error instanceof HostifyApiError &&
				!error.retryable &&
				(error.status === 409 || error.status === 422)
			) {
				return {
					kind: "unavailable",
					message:
						error.providerMessage ?? "These dates are no longer available.",
				};
			}
			const classified = classifyError(error);
			return {
				code: classified.code,
				kind: classified.transient ? "transient" : "permanent",
				message: classified.message,
			};
		}
	}

	async findExistingHold(query: FindHoldQuery): Promise<PlacedHold | null> {
		try {
			for (let page = 1; ; page += 1) {
				const response = await this.#client.reservations.list(
					{
						filters: [
							{ field: "checkIn", operator: "=", value: query.checkIn },
							{ field: "checkOut", operator: "=", value: query.checkOut },
						],
						listing_id: query.listingId,
						page,
						per_page: HOLD_LOOKUP_PAGE_SIZE,
					},
					this.#context,
				);
				const match = response.reservations.find((reservation) => {
					const shape = reservation as HostifyReservationShape;
					if (
						typeof shape.status === "string" &&
						CANCELLED_PROVIDER_STATUSES.has(shape.status)
					) {
						return false;
					}
					return (
						typeof shape.notes === "string" && shape.notes.includes(query.tag)
					);
				});
				if (match) {
					const shape = match as HostifyReservationShape;
					if (shape.id === null || shape.id === undefined) {
						return null;
					}
					const reservationId = String(shape.id);
					const transactionId = await this.#findHoldTransactionId(
						reservationId,
						query.tag,
					);
					return {
						providerStatus: shape.status ?? null,
						raw: toRecord(match),
						reservationId,
						transactionId,
					};
				}
				if (response.reservations.length < HOLD_LOOKUP_PAGE_SIZE) {
					return null;
				}
			}
		} catch (error) {
			const classified = classifyError(error);
			if (classified.transient) {
				return null;
			}
			throw error;
		}
	}

	async #findHoldTransactionId(
		reservationId: string,
		tag: string,
	): Promise<string | null> {
		try {
			const response = await this.#client.transactions.list(
				{ reservation_id: reservationId },
				this.#context,
			);
			const transactions = response.transaction as HostifyTransactionShape[];
			const match = transactions.find(
				(transaction) =>
					transaction.id !== null &&
					transaction.id !== undefined &&
					typeof transaction.details === "string" &&
					transaction.details.includes(tag),
			);
			return match?.id === null || match?.id === undefined
				? null
				: String(match.id);
		} catch (error) {
			const classified = classifyError(error);
			if (classified.transient) {
				return null;
			}
			throw error;
		}
	}

	async confirmHold(args: ConfirmHoldArgs): Promise<MutateHoldResult> {
		try {
			await this.#client.reservations.update(
				args.reservationId,
				{ status: "accepted" },
				this.#context,
			);
		} catch (error) {
			logUnexpectedResponseShape("confirm", args.reservationId, error);
			// The PUT itself failed. The accept may still have applied server-side, or
			// the hold may have died (auto-deny), so a live re-read is the authority,
			// never the thrown error. If the reservation cannot be read either, the
			// status is unknown and stays retryable.
			const verified = await this.#verifyConfirmStatus(args.reservationId);
			if (verified.kind === "transient") {
				return verified;
			}
			if (verified.kind === "ok") {
				await this.#completeHoldTransaction(
					args.transactionId,
					args.paymentReference,
				);
			}
			return verified;
		}

		// Hostify echoes the requested status on a successful PUT even when the change
		// does not take (a far-future accept returns `accepted` but the reservation
		// stays `pending`). The live reservation is authoritative, not the PUT echo.
		const verified = await this.#verifyConfirmStatus(args.reservationId);
		if (verified.kind === "ok") {
			await this.#completeHoldTransaction(
				args.transactionId,
				args.paymentReference,
			);
		}
		return verified;
	}

	/**
	 * Re-reads a reservation to classify a confirm against its live status rather
	 * than the PUT echo. `accepted` is a real confirm (`ok`); a
	 * denied/cancelled/no-show status means the hold died and can never be confirmed
	 * (`permanent`, which drives compensation); anything still `pending` means the
	 * accept has not taken yet (`not_settled`) and must be retried without ever
	 * refunding a live, paid hold. A failed read means status is unknown after a
	 * confirm attempt, so it stays retryable regardless of the original PUT error.
	 */
	async #verifyConfirmStatus(reservationId: string): Promise<MutateHoldResult> {
		try {
			const response = await this.#client.reservations.get(
				reservationId,
				{},
				this.#context,
			);
			const reservation = response.reservation as HostifyReservationShape;
			const status =
				typeof reservation.status === "string" ? reservation.status : null;
			const raw = toRecord(response.reservation);
			if (status === "accepted") {
				return { kind: "ok", providerStatus: status, raw };
			}
			if (status !== null && CANCELLED_PROVIDER_STATUSES.has(status)) {
				return {
					code: `hold_${status}`,
					kind: "permanent",
					message: `Hostify reservation ${reservationId} is ${status}; the hold can no longer be confirmed.`,
				};
			}
			logger.warn(
				"Hostify accept did not settle; reservation still unconfirmed after update",
				{ providerStatus: status, reservationId },
			);
			return { kind: "not_settled", providerStatus: status, raw };
		} catch (error) {
			return toConfirmStatusReadFailure(error, reservationId);
		}
	}

	async cancelHold(args: CancelHoldArgs): Promise<SettledMutateResult> {
		try {
			const response = await this.#client.reservations.update(
				args.reservationId,
				{ notes: args.reason, status: "cancelled_by_host" },
				this.#context,
			);
			await this.#voidHoldTransaction(args.transactionId, args.reason);
			return {
				kind: "ok",
				providerStatus: response.update_data?.status ?? null,
				raw: toRecord(response.update_data),
			};
		} catch (error) {
			logUnexpectedResponseShape("cancel", args.reservationId, error);
			const reconciled = await this.#reconcileStatus(
				args.reservationId,
				(status) => CANCELLED_PROVIDER_STATUSES.has(status),
			);
			if (reconciled) {
				await this.#voidHoldTransaction(args.transactionId, args.reason);
				return reconciled;
			}
			return toMutationFailure(error);
		}
	}

	async cancelReservation(args: CancelHoldArgs): Promise<SettledMutateResult> {
		return this.cancelHold(args);
	}

	/**
	 * Creates the incomplete accommodation transaction tied to a fresh hold. Best
	 * effort: a failure leaves the reservation held without a financial record,
	 * which is recoverable, so it returns null rather than throwing.
	 */
	async #createHoldTransaction(
		reservationId: string,
		transaction: Omit<HostifyCreateTransactionInput, "reservation_id">,
	): Promise<string | null> {
		try {
			const response = await this.#client.transactions.create(
				{ ...transaction, reservation_id: reservationId },
				this.#context,
			);
			const id = (response.transaction as { id?: number | string | null }).id;
			return id === null || id === undefined ? null : String(id);
		} catch {
			return null;
		}
	}

	/** Marks the hold's transaction completed on acceptance (accounting; best-effort). */
	async #completeHoldTransaction(
		transactionId: string | null,
		paymentReference: string | null,
	): Promise<void> {
		if (!transactionId) {
			return;
		}
		try {
			await this.#client.transactions.update(
				transactionId,
				{
					details: `Stripe completed payment_id: ${paymentReference ?? "unknown"}`,
					is_completed: 1,
				},
				this.#context,
			);
		} catch {
			// Divergence is reconciled separately; never fail the confirm over it.
		}
	}

	/** Leaves the hold's transaction incomplete with an audit note on release. */
	async #voidHoldTransaction(
		transactionId: string | null,
		reason: string,
	): Promise<void> {
		if (!transactionId) {
			return;
		}
		try {
			await this.#client.transactions.update(
				transactionId,
				{ details: `Released: ${reason}`, is_completed: 0 },
				this.#context,
			);
		} catch {
			// Best-effort; the reservation cancel is the authoritative release.
		}
	}

	/**
	 * Re-reads a reservation after a failed mutation; if the provider already
	 * reflects the intended terminal status the mutation was effectively applied,
	 * so the operation is reported as `ok`. A failed re-read returns null and the
	 * caller falls back to classifying the original error.
	 */
	async #reconcileStatus(
		reservationId: string,
		isSettled: (status: string) => boolean,
	): Promise<SettledMutateResult | null> {
		try {
			const response = await this.#client.reservations.get(
				reservationId,
				{},
				this.#context,
			);
			const reservation = response.reservation as HostifyReservationShape;
			if (
				typeof reservation.status === "string" &&
				isSettled(reservation.status)
			) {
				return {
					kind: "ok",
					providerStatus: reservation.status,
					raw: toRecord(response.reservation),
				};
			}
			return null;
		} catch {
			return null;
		}
	}
}

function classifyBokunError(error: unknown): ClassifiedError {
	if (error instanceof BokunApiError) {
		return {
			code: `http_${error.status}`,
			message: error.providerMessage ?? error.message,
			transient: error.retryable,
		};
	}
	if (
		error instanceof BokunTimeoutError ||
		error instanceof BokunNetworkError
	) {
		return { code: error.name, message: error.message, transient: true };
	}
	if (error instanceof BokunResponseValidationError) {
		return { code: error.name, message: error.message, transient: false };
	}
	return {
		code: error instanceof Error ? error.name : "unknown_error",
		message: error instanceof Error ? error.message : String(error),
		transient: false,
	};
}

function toBokunMutationFailure(error: unknown): SettledMutateResult {
	const classified = classifyBokunError(error);
	if (error instanceof BokunResponseValidationError) {
		return {
			code: classified.code,
			kind: "transient",
			message: classified.message,
		};
	}
	return toMutateFailure(classified);
}

function optionalString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return null;
}

function recordValue(
	value: unknown,
	key: string,
): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const nested = (value as Record<string, unknown>)[key];
	return nested && typeof nested === "object"
		? (nested as Record<string, unknown>)
		: null;
}

function checkoutBooking(
	response: Record<string, unknown>,
): Record<string, unknown> | null {
	return recordValue(response, "booking");
}

function checkoutConfirmationCode(
	response: Record<string, unknown>,
): string | null {
	const booking = checkoutBooking(response);
	return (
		optionalString(response.confirmationCode) ??
		optionalString(booking?.confirmationCode)
	);
}

function checkoutProviderStatus(
	response: Record<string, unknown>,
): string | null {
	return optionalString(checkoutBooking(response)?.status);
}

function checkoutActivityProductCode(
	response: Record<string, unknown>,
): string | null {
	const activityBookings = checkoutBooking(response)?.activityBookings;
	if (!Array.isArray(activityBookings)) {
		return null;
	}
	for (const item of activityBookings) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const row = item as Record<string, unknown>;
		const code =
			optionalString(row.productConfirmationCode) ??
			optionalString(row.confirmationCode) ??
			optionalString(row.id);
		if (code) {
			return code;
		}
	}
	return null;
}

function bookingStatus(raw: Record<string, unknown>): string | null {
	return optionalString(raw.status)?.toUpperCase() ?? null;
}

function buildBokunBookingConfirmation(
	args: ConfirmHoldArgs,
): Record<string, unknown> {
	return {
		...(args.amountMinor !== undefined && args.currency
			? { amount: toProviderMoney(args.amountMinor, args.currency) }
			: {}),
		...(args.currency ? { currency: args.currency.toUpperCase() } : {}),
		externalBookingEntityCode: "alojamentoideal",
		externalBookingEntityName: "Alojamento Ideal",
		externalBookingReference: args.publicReference ?? args.reservationId,
		sendNotificationToMainContact: false,
		showPricesInNotification: true,
		transactionDetails: {
			transactionDate: new Date().toISOString(),
			transactionId: args.paymentReference ?? args.reservationId,
		},
	};
}

export interface BokunReservationGatewayOptions {
	client: BokunClient;
	context?: BokunRequestContext;
	lang?: string;
}

/**
 * Bokun implementation of {@link ProviderReservationGateway} for activity-only
 * holds. The provider reservation id is Bokun's booking confirmation code; the
 * provider transaction id stores the first activity product confirmation code
 * when Bokun returns one.
 */
export class BokunReservationGateway implements ProviderReservationGateway {
	readonly #client: BokunClient;
	readonly #context?: BokunRequestContext;
	readonly #lang?: string;

	constructor(options: BokunReservationGatewayOptions) {
		this.#client = options.client;
		this.#context = options.context;
		this.#lang = options.lang;
	}

	async placeHold(request: ProviderHoldRequest): Promise<PlaceHoldResult> {
		if (request.kind !== "bokun_activity") {
			return {
				code: "invalid_hold_request",
				kind: "permanent",
				message: "Bokun cannot place accommodation holds.",
			};
		}

		try {
			const response = (await this.#client.v1.checkout.submit(
				buildBokunActivityCheckoutRequest(request),
				this.#lang ? { lang: this.#lang } : {},
				this.#context,
			)) as Record<string, unknown>;

			const reservationId = checkoutConfirmationCode(response);
			if (!reservationId) {
				if (response.success === false) {
					return {
						kind: "unavailable",
						message: "This activity is no longer available.",
					};
				}
				return {
					code: "missing_confirmation_code",
					kind: "permanent",
					message: "Bokun reserved an activity without a confirmation code.",
				};
			}

			return {
				kind: "created",
				providerStatus: checkoutProviderStatus(response) ?? "RESERVED",
				raw: toRecord(response),
				reservationId,
				transactionId: checkoutActivityProductCode(response),
			};
		} catch (error) {
			if (
				error instanceof BokunApiError &&
				!error.retryable &&
				(error.status === 409 || error.status === 422)
			) {
				return {
					kind: "unavailable",
					message:
						error.providerMessage ?? "This activity is no longer available.",
				};
			}
			// A 400 is Bokun rejecting the request shape (missing/invalid answers or
			// pickup place), not lost availability. It is recoverable once the guest
			// fixes the affected details, so it must not fail the order or wipe the
			// cart the way `unavailable` does.
			if (error instanceof BokunApiError && error.status === 400) {
				return {
					kind: "invalid",
					message:
						error.providerMessage ??
						"Some booking details are missing or invalid.",
				};
			}
			const classified = classifyBokunError(error);
			return {
				code: classified.code,
				kind: classified.transient ? "transient" : "permanent",
				message: classified.message,
			};
		}
	}

	async findExistingHold(_query: FindHoldQuery): Promise<PlacedHold | null> {
		return null;
	}

	async confirmHold(args: ConfirmHoldArgs): Promise<MutateHoldResult> {
		try {
			const response = (await this.#client.v1.checkout.confirmReserved(
				args.reservationId,
				buildBokunBookingConfirmation(args),
				this.#context,
			)) as Record<string, unknown>;
			const status = checkoutProviderStatus(response);
			if (status && BOKUN_HOLD_STATUSES.has(status.toUpperCase())) {
				return { kind: "not_settled", providerStatus: status, raw: response };
			}
			if (response.success === false) {
				return {
					code: "confirm_failed",
					kind: "permanent",
					message: "Bokun did not confirm the reserved activity.",
				};
			}
			return {
				kind: "ok",
				providerStatus: status ?? "CONFIRMED",
				raw: toRecord(response),
			};
		} catch (error) {
			const verified = await this.#verifyBookingStatus(args.reservationId);
			if (verified) {
				return verified;
			}
			return toBokunMutationFailure(error);
		}
	}

	async cancelHold(args: CancelHoldArgs): Promise<SettledMutateResult> {
		try {
			const response = (await this.#client.v1.booking.abortReserved(
				args.reservationId,
				{},
				this.#context,
			)) as Record<string, unknown>;
			return {
				kind: "ok",
				providerStatus: "ABORTED",
				raw: toRecord(response),
			};
		} catch (error) {
			const verified = await this.#verifyBookingReleased(args.reservationId);
			if (verified) {
				return verified;
			}
			return toBokunMutationFailure(error);
		}
	}

	async cancelReservation(args: CancelHoldArgs): Promise<SettledMutateResult> {
		try {
			const body = { notify: false, refund: false };
			const response = (
				args.transactionId
					? await this.#client.v1.booking.cancelProductBooking(
							args.transactionId,
							body,
							this.#context,
						)
					: await this.#client.v1.booking.cancel(
							args.reservationId,
							body,
							this.#context,
						)
			) as Record<string, unknown>;
			if (response.success === false) {
				return {
					code: "cancel_failed",
					kind: "permanent",
					message: "Bokun did not cancel the activity booking.",
				};
			}
			return {
				kind: "ok",
				providerStatus: "CANCELLED",
				raw: toRecord(response),
			};
		} catch (error) {
			const verified = await this.#verifyBookingCancelled(args.reservationId);
			if (verified) {
				return verified;
			}
			return toBokunMutationFailure(error);
		}
	}

	async #verifyBookingStatus(
		confirmationCode: string,
	): Promise<MutateHoldResult | null> {
		try {
			const response = (await this.#client.v1.booking.getByConfirmationCode(
				confirmationCode,
				{},
				this.#context,
			)) as Record<string, unknown>;
			const status = bookingStatus(response);
			if (status && BOKUN_CONFIRMED_STATUSES.has(status)) {
				return { kind: "ok", providerStatus: status, raw: response };
			}
			if (status && BOKUN_HOLD_STATUSES.has(status)) {
				return { kind: "not_settled", providerStatus: status, raw: response };
			}
			if (status && BOKUN_TERMINAL_STATUSES.has(status)) {
				return {
					code: `hold_${status.toLowerCase()}`,
					kind: "permanent",
					message: `Bokun booking ${confirmationCode} is ${status}; the hold can no longer be confirmed.`,
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	async #verifyBookingReleased(
		confirmationCode: string,
	): Promise<SettledMutateResult | null> {
		try {
			const response = (await this.#client.v1.booking.getByConfirmationCode(
				confirmationCode,
				{},
				this.#context,
			)) as Record<string, unknown>;
			const status = bookingStatus(response);
			if (status && BOKUN_TERMINAL_STATUSES.has(status)) {
				return { kind: "ok", providerStatus: status, raw: response };
			}
			if (status && BOKUN_CONFIRMED_STATUSES.has(status)) {
				return {
					code: `hold_${status.toLowerCase()}`,
					kind: "permanent",
					message: `Bokun booking ${confirmationCode} is ${status}; the hold can no longer be aborted.`,
				};
			}
			if (status && BOKUN_HOLD_STATUSES.has(status)) {
				return {
					code: "cancel_not_settled",
					kind: "transient",
					message: `Bokun booking ${confirmationCode} is still ${status}; abort must be retried.`,
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Post-failure verification for `cancelReservation`. Unlike the abort path,
	 * a booking still confirmed does not mean the operation is impossible: it
	 * means the cancel has not landed yet, so every non-terminal status maps to
	 * a retryable failure instead of a permanent one.
	 */
	async #verifyBookingCancelled(
		confirmationCode: string,
	): Promise<SettledMutateResult | null> {
		try {
			const response = (await this.#client.v1.booking.getByConfirmationCode(
				confirmationCode,
				{},
				this.#context,
			)) as Record<string, unknown>;
			const status = bookingStatus(response);
			if (status && BOKUN_TERMINAL_STATUSES.has(status)) {
				return { kind: "ok", providerStatus: status, raw: response };
			}
			if (
				status &&
				(BOKUN_CONFIRMED_STATUSES.has(status) ||
					BOKUN_HOLD_STATUSES.has(status))
			) {
				return {
					code: "cancel_not_settled",
					kind: "transient",
					message: `Bokun booking ${confirmationCode} is still ${status}; the cancellation must be retried.`,
				};
			}
			return null;
		} catch {
			return null;
		}
	}
}

function toMutateFailure(classified: ClassifiedError): SettledMutateResult {
	return {
		code: classified.code,
		kind: classified.transient ? "transient" : "permanent",
		message: classified.message,
	};
}

/**
 * Failure mapping for the confirm/cancel mutation paths. An unparseable response
 * is forced to transient here (overriding the default permanent classification)
 * because the mutation may have applied server-side: retrying and reconciling
 * against live state is safer than refunding a possibly-settled booking.
 */
function toMutationFailure(error: unknown): SettledMutateResult {
	const classified = classifyError(error);
	if (error instanceof HostifyResponseValidationError) {
		return {
			code: classified.code,
			kind: "transient",
			message: classified.message,
		};
	}
	return toMutateFailure(classified);
}

function toConfirmStatusReadFailure(
	error: unknown,
	reservationId: string,
): SettledMutateResult {
	const classified = classifyError(error);
	return {
		code: `confirm_status_unknown_${classified.code}`,
		kind: "transient",
		message: `Could not verify Hostify reservation ${reservationId} after confirm attempt; reservation status is unknown. ${classified.message}`,
	};
}

/** Prefix marking a synthetic reservation id produced by the dry-run gateway. */
export const STUB_RESERVATION_PREFIX = "STUB";

/**
 * Dry-run {@link ProviderReservationGateway} that performs no provider I/O.
 *
 * Used as a development/production safety switch (`HOSTIFY_BOOKINGS_ENABLED=false`,
 * wired in `apps/web/lib/api/commerce.ts`): every hold operation succeeds with a
 * synthetic reservation id, so the full reserve-first saga — order state machine,
 * Stripe charge, confirmation/refund emails and the reconciler cron — runs exactly
 * as in production, but **no real Hostify reservation or transaction is created**.
 *
 * The synthetic id is a unique `STUB-<uuid>`, so it never collides on the
 * `(provider, external_account_id, provider_reservation_id)` unique index and is
 * trivially recognisable in the database. `findExistingHold` returns null because
 * the orchestrator already dedupes retries on the persisted `providerReservationId`
 * before it ever reaches the gateway.
 */
export class StubReservationGateway implements ProviderReservationGateway {
	async placeHold(request: ProviderHoldRequest): Promise<PlaceHoldResult> {
		return {
			kind: "created",
			providerStatus:
				request.kind === "bokun_activity"
					? "RESERVED"
					: request.reservation.status,
			raw: { stub: true },
			reservationId: `${STUB_RESERVATION_PREFIX}-${randomUUID()}`,
			transactionId: null,
		};
	}

	async confirmHold(_args: ConfirmHoldArgs): Promise<MutateHoldResult> {
		return { kind: "ok", providerStatus: "accepted", raw: { stub: true } };
	}

	async cancelHold(_args: CancelHoldArgs): Promise<SettledMutateResult> {
		return {
			kind: "ok",
			providerStatus: "cancelled_by_host",
			raw: { stub: true },
		};
	}

	async cancelReservation(_args: CancelHoldArgs): Promise<SettledMutateResult> {
		return {
			kind: "ok",
			providerStatus: "cancelled_by_host",
			raw: { stub: true },
		};
	}

	async findExistingHold(_query: FindHoldQuery): Promise<PlacedHold | null> {
		return null;
	}
}
