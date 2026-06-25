import type { HostifyClient } from "../integrations/hostify";
import {
	HostifyApiError,
	type HostifyCreateReservationInput,
	type HostifyCreateTransactionInput,
	HostifyNetworkError,
	type HostifyRequestContext,
	HostifyTimeoutError,
} from "../integrations/hostify";
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

export interface ReservationContact {
	email: string;
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
	reservation: HostifyCreateReservationInput;
	/** Transaction payload sans `reservation_id` (filled once the hold exists). */
	transaction: Omit<HostifyCreateTransactionInput, "reservation_id">;
}

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

/** Converts integer minor units to the decimal major-unit number Hostify expects. */
function toHostifyMoney(minor: number, currency: string): number {
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
		base_price: toHostifyMoney(basePriceMinor, currency),
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
		tax_amount: toHostifyMoney(taxMinor, currency),
		total_price: toHostifyMoney(input.itemTotalMinor, currency),
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
		amount: toHostifyMoney(input.itemTotalMinor, input.currency),
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
		reservation: buildCreateReservationInput(input),
		transaction: buildTransactionInput(input),
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
	/** Stripe payment reference recorded on the transaction detail. */
	paymentReference: string | null;
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
	| { code: string; kind: "transient"; message: string }
	| { code: string; kind: "permanent"; message: string };

export type MutateHoldResult =
	| { kind: "ok"; providerStatus: string | null; raw: Record<string, unknown> }
	| { code: string; kind: "transient"; message: string }
	| { code: string; kind: "permanent"; message: string };

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
	cancelHold(args: CancelHoldArgs): Promise<MutateHoldResult>;
	confirmHold(args: ConfirmHoldArgs): Promise<MutateHoldResult>;
	findExistingHold(query: FindHoldQuery): Promise<PlacedHold | null>;
	placeHold(request: HostifyHoldRequest): Promise<PlaceHoldResult>;
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
	return {
		code: error instanceof Error ? error.name : "unknown_error",
		message: error instanceof Error ? error.message : String(error),
		transient: false,
	};
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

	async placeHold(request: HostifyHoldRequest): Promise<PlaceHoldResult> {
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
			const response = await this.#client.reservations.update(
				args.reservationId,
				{ status: "accepted" },
				this.#context,
			);
			const reservation = response.reservation as HostifyReservationShape;
			await this.#completeHoldTransaction(
				args.transactionId,
				args.paymentReference,
			);
			return {
				kind: "ok",
				providerStatus: reservation.status ?? null,
				raw: toRecord(response.reservation),
			};
		} catch (error) {
			// A failed confirm on an already-accepted reservation (re-delivery race)
			// must not trigger a false compensation: re-read and treat as success.
			const reconciled = await this.#reconcileStatus(
				args.reservationId,
				(status) => status === "accepted",
			);
			if (reconciled) {
				await this.#completeHoldTransaction(
					args.transactionId,
					args.paymentReference,
				);
				return reconciled;
			}
			return toMutateFailure(classifyError(error));
		}
	}

	async cancelHold(args: CancelHoldArgs): Promise<MutateHoldResult> {
		try {
			const response = await this.#client.reservations.update(
				args.reservationId,
				{ notes: args.reason, status: "cancelled_by_host" },
				this.#context,
			);
			const reservation = response.reservation as HostifyReservationShape;
			await this.#voidHoldTransaction(args.transactionId, args.reason);
			return {
				kind: "ok",
				providerStatus: reservation.status ?? null,
				raw: toRecord(response.reservation),
			};
		} catch (error) {
			const reconciled = await this.#reconcileStatus(
				args.reservationId,
				(status) => CANCELLED_PROVIDER_STATUSES.has(status),
			);
			if (reconciled) {
				await this.#voidHoldTransaction(args.transactionId, args.reason);
				return reconciled;
			}
			return toMutateFailure(classifyError(error));
		}
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
	): Promise<MutateHoldResult | null> {
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

function toMutateFailure(classified: ClassifiedError): MutateHoldResult {
	return {
		code: classified.code,
		kind: classified.transient ? "transient" : "permanent",
		message: classified.message,
	};
}
