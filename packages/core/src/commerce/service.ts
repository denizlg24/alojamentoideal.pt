import { timingSafeEqual } from "node:crypto";
import {
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
	type AppliedDiscountSnapshot,
	accommodationItemDetail as accommodationItemDetailTable,
	accommodationListing as accommodationListingTable,
	accommodationQuoteSnapshot as accommodationQuoteSnapshotTable,
	apiIdempotencyKey as apiIdempotencyKeyTable,
	bookingGuest as bookingGuestTable,
	cartItem as cartItemTable,
	cart as cartTable,
	conversationMessage as conversationMessageTable,
	conversation as conversationTable,
	type Database,
	type OrderBillingAddressSnapshot,
	orderContact as orderContactTable,
	orderItemCharge as orderItemChargeTable,
	orderItem as orderItemTable,
	orderMember as orderMemberTable,
	order as orderTable,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { parseQuoteBody } from "../accommodations";
import type { RefundRequest, RefundResult } from "../integrations/stripe";
import { trackEvent } from "../observability";
import {
	type ConversationMessageDto,
	type ConversationSummary,
	noopRealtimePublisher,
	normalizeConversationPreview,
	type ProviderConversationGateway,
	type ProviderConversationMessage,
	type RealtimePublisher,
	type ReconcileConversationsSummary,
	trimMessageBody,
} from "./conversations";
import { CommerceError, invalidRequest } from "./errors";
import { hashIdempotencyRequest, idempotencyExpiresAt } from "./idempotency";
import { housingFeeMinor, normalizeAccommodationQuoteSnapshot } from "./money";
import {
	canAcceptMember,
	generateMemberToken,
	hashMemberToken,
	isMemberTokenExpired,
	memberInviteExpiresAt,
	type OrderAccessContext,
	type OrderPermission,
	orderMemberCapacity,
	orderRoleCan,
	type ResolvedOrder,
	type ResolvedOrderAccess,
} from "./order-access";
import {
	type OrderContactSummary,
	type OrderDetail,
	type OrderDetailCharge,
	type OrderDetailItem,
	type OrderDetailMember,
	summarizeGuestProgress,
} from "./order-detail";
import {
	allocateDiscountByHousingBase,
	buildDiscountChargeRow,
	buildDraftOrderRows,
	generatePublicOrderReference,
} from "./orders";
import {
	type CancelOrderReservationsResult,
	type CompensateOrderResult,
	type ConfirmOrderReservationsResult,
	type HoldOrderResult,
	type MarkOrderPaidResult,
	type OrderCompensationEmailKind,
	type OrderCompensationFacts,
	type OrderConfirmationFacts,
	type OrderFinalizationEmailKind,
	type OrderPaymentFailureInput,
	type OrderStatusRecord,
	type PayableOrder,
	type PaymentAmount,
	type PaymentIntentLiveStatus,
	type ReconcileReservationsSummary,
	type RecordOrderPaymentFailureResult,
	toOrderBookingStatus,
} from "./payments";
import {
	buildHoldRequest,
	type ProviderReservationGateway,
	type ReservationChargeInput,
	reservationTag,
} from "./reservations";
import type {
	AddCartItemBody,
	ApplyDiscountBody,
	DeleteCartItemBody,
	DraftOrderBody,
	UpdateCartItemBody,
} from "./schemas";
import { assertMutableCart, toCartStatus } from "./state";
import { computeDiscountMinor, sumCartTotals } from "./totals";
import type {
	CartDto,
	CartItemDto,
	CartMutationResponse,
	CartOwner,
	CartResponse,
	CartValidationFailure,
	CartValidationResponse,
	CommerceQuoteDto,
	CommerceQuoteInput,
	DraftOrderContactInput,
	DraftOrderResponse,
	ListingDisplaySnapshot,
	NormalizedAccommodationQuoteSnapshot,
	QuoteValidationStatus,
} from "./types";

const CART_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PROPERTY_TIMEZONE = "Europe/Lisbon";

// Reservation-saga retry/backoff bounds (Part A columns drive the cron).
const RESERVATION_RETRY_BASE_MS = 60 * 1000;
const RESERVATION_RETRY_MAX_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RESERVATION_ATTEMPTS = 6;
const DEFAULT_RESERVATION_SOURCE = "alojamentoideal";
// Grace past `checkoutExpiresAt` before the cron releases an abandoned hold.
const ABANDONED_HOLD_GRACE_MS = 5 * 60 * 1000;
const REFUND_REQUESTED_FAILURE_DETAIL =
	"Compensation refund requested; awaiting Stripe result.";
const REFUND_COMPLETED_FAILURE_DETAIL =
	"Compensation refund accepted by Stripe.";
const REFUND_STATE_UNKNOWN_FAILURE_DETAIL =
	"Compensation refund was already requested, but no local Stripe refund id is recorded. Verify Stripe before retrying.";
const FINALIZATION_EMAIL_RETRY_BASE_MS = 5 * 60 * 1000;
const FINALIZATION_EMAIL_RETRY_MAX_MS = 60 * 60 * 1000;
const FINALIZATION_EMAIL_CLAIM_MS = 5 * 60 * 1000;
const DEFAULT_CONVERSATION_MESSAGE_LIMIT = 100;
const MAX_CONVERSATION_MESSAGE_LIMIT = 200;

const conversationSummarySelection = {
	externalThreadId: conversationTable.externalThreadId,
	id: conversationTable.id,
	lastMessageAt: conversationTable.lastMessageAt,
	lastMessagePreview: conversationTable.lastMessagePreview,
	providerBookingId: conversationTable.providerBookingId,
	status: conversationTable.status,
	unreadCount: conversationTable.unreadCount,
};

const conversationMessageSelection = {
	body: conversationMessageTable.body,
	conversationId: conversationMessageTable.conversationId,
	deliveryStatus: conversationMessageTable.deliveryStatus,
	externalMessageId: conversationMessageTable.externalMessageId,
	id: conversationMessageTable.id,
	isAutomatic: conversationMessageTable.isAutomatic,
	readAt: conversationMessageTable.readAt,
	senderMemberId: conversationMessageTable.senderMemberId,
	senderType: conversationMessageTable.senderType,
	sentAt: conversationMessageTable.sentAt,
};

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;

function stayDateToTimestamp(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`);
}

function compensationRefundIdempotencyKey(
	orderId: string,
	paymentIntentId: string,
	amountMinor: number,
): string {
	return `refund:${orderId}:${paymentIntentId}:${amountMinor}`;
}

function compensationEmailKindForReason(
	reason: string,
): OrderCompensationEmailKind {
	return reason === "amount_mismatch"
		? "refund_amount_mismatch"
		: "refund_unconfirmed";
}

function isCompensationEmailKind(
	kind: string | null,
): kind is OrderCompensationEmailKind {
	return kind === "refund_amount_mismatch" || kind === "refund_unconfirmed";
}

function isFinalizationEmailKind(
	kind: string | null,
): kind is OrderFinalizationEmailKind {
	return kind === "confirmation" || isCompensationEmailKind(kind);
}

export interface CommerceServiceOptions {
	accountId: string;
	currency: string;
	db: Database;
	provider: string;
	quoteAccommodation: (
		input: CommerceQuoteInput,
	) => Promise<import("../accommodations").AccommodationQuoteResult>;
	quoteTtlSeconds: number;
	/**
	 * Resolves a promotion code against the discount provider (Stripe). Returns
	 * `null` for unknown/inactive/expired codes; throws for provider/transport
	 * failures so the service can distinguish "invalid" from "unavailable".
	 */
	resolveDiscount: (code: string) => Promise<AppliedDiscountSnapshot | null>;
	/**
	 * Resolves the provider-keyed reservation gateway the saga dispatches through.
	 * Optional so cart/quote-only callers and unit tests need not wire a provider
	 * client; the saga reports `transient_error`/`not_holdable` when absent.
	 */
	resolveReservationGateway?: (
		provider: string,
	) => ProviderReservationGateway | undefined;
	/** Resolves provider inbox/chat transport for order conversations. */
	resolveConversationGateway?: (
		provider: string,
	) => ProviderConversationGateway | undefined;
	/** Publishes conversation/message updates to browsers. Defaults to no-op. */
	realtimePublisher?: RealtimePublisher;
	/** Issues a Stripe refund during compensation; required for auto-refund (D4). */
	refundPayment?: (request: RefundRequest) => Promise<RefundResult>;
	/** Reads live PaymentIntent status for the reconciler (webhook-missed path). */
	retrievePaymentIntent?: (
		paymentIntentId: string,
	) => Promise<PaymentIntentLiveStatus>;
	/** Auto full-refund on permanent post-charge failure (D4). Defaults to true. */
	autoRefundOnFailure?: boolean;
	/** Retry cap before a hold step is flagged `needsRecovery`. Defaults to 6. */
	maxReservationAttempts?: number;
	/** Hostify `source` tag stamped on every direct hold. */
	reservationSource?: string;
}

interface CreateCartInput {
	cartId?: string;
	idempotencyKey?: string;
}

interface ActiveItemInput {
	itemId: string;
	quoteInput: CommerceQuoteInput;
}

interface IssueMemberTokenResult {
	memberId: string;
	token: string;
}

interface RedeemMemberTokenOptions {
	/** Bind the redeeming visitor's account to the member when signed in. */
	userId?: string | null;
}

/**
 * Outcome of issuing or rotating an invite for a `member`. Carries the raw token
 * (delivered once, by email) plus the persisted row's identity and lifetime so
 * the caller can both send the magic-link and echo the new member back to the UI.
 */
interface InviteMemberResult {
	email: string;
	expiresAt: Date;
	memberId: string;
	token: string;
}

/**
 * Delivers a freshly issued invite token (the web email transport). Invoked
 * before the token is persisted so a delivery failure leaves no dangling or
 * prematurely rotated row — the proportionate guarantee until a durable outbox
 * exists.
 */
type InviteDelivery = (delivery: {
	email: string;
	token: string;
}) => Promise<void>;

/** Lightweight address shape check for invite recipients (defence, not parsing). */
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RevalidatedSnapshot {
	itemId: string;
	snapshot: NormalizedAccommodationQuoteSnapshot;
}

interface RevalidatedCartDiscount {
	applied: AppliedDiscountSnapshot | null;
	resolved: AppliedDiscountSnapshot | null;
}

/** One provider booking joined with its order item + accommodation detail. */
interface SagaBooking {
	attemptCount: number;
	charges: ReservationChargeInput[];
	checkIn: string;
	checkOut: string;
	guests: number;
	hostifyListingId: string;
	imageUrlSnapshot: string | null;
	itemTotalMinor: number;
	normalizedStatus: string;
	orderItemId: string;
	pets: number;
	provider: string;
	providerBookingId: string;
	providerReservationId: string | null;
	providerTransactionId: string | null;
	titleSnapshot: string;
}

/** Everything the saga needs to drive one order's provider holds. */
interface SagaContext {
	bookings: SagaBooking[];
	contact: {
		billingAddress: OrderBillingAddressSnapshot;
		email: string;
		name: string;
		phoneE164: string;
	} | null;
	order: {
		amountPaidMinor: number;
		amountRefundedMinor: number;
		checkoutExpiresAt: Date | null;
		currency: string;
		finalizationEmailAttemptCount: number;
		finalizationEmailKind: string | null;
		finalizationEmailNextAttemptAt: Date;
		finalizationEmailSentAt: Date | null;
		failureCode: string | null;
		id: string;
		publicReference: string;
		refundRequestedAt: Date | null;
		status: string;
		stripePaymentIntentId: string | null;
		stripeRefundId: string | null;
		stripeRefundIdempotencyKey: string | null;
	};
}

type HoldItemResult =
	| "held"
	| "transient"
	| "permanent"
	| { unavailable: string };
type MutateItemResult = "ok" | "transient" | "permanent";
type PersistHoldPlacedResult = "already_linked" | "conflict" | "persisted";

/** Email side-effects the reconciler delegates back to the app (transport seam). */
interface ReconcileHandlers {
	onCompensated?: (facts: OrderCompensationFacts) => Promise<void>;
	onConfirmed?: (facts: OrderConfirmationFacts) => Promise<void>;
}

interface CartJoinedRow {
	cartItemId: string;
	checkIn: string;
	checkOut: string;
	city: string | null;
	country: string | null;
	currency: string;
	externalAccountId: string;
	feeLines: NormalizedAccommodationQuoteSnapshot["feeLines"];
	fetchedAt: Date;
	guests: number;
	housingFeeMinor: number | null;
	imageFallbackName: string | null;
	infants: number;
	itemStatus: string;
	listingExternalId: string;
	nightlyAverageMinor: number | null;
	nights: number;
	pets: number;
	position: number;
	processed: AccommodationListingProcessedContent | null;
	provider: string;
	providerPayload: Record<string, unknown> | null;
	quoteAdults: number;
	quoteChildren: number;
	quoteCleaningFeeMinor: number | null;
	quoteExpiresAt: Date;
	quoteId: string;
	quoteStatus: string;
	raw: AccommodationListingRawContent | null;
	subtotalMinor: number;
	taxMinor: number;
	timezone: string | null;
	totalMinor: number;
	updatedAt: Date;
}

export class CommerceService {
	readonly #accountId: string;
	readonly #currency: string;
	readonly #db: Database;
	readonly #provider: string;
	readonly #quoteAccommodation: CommerceServiceOptions["quoteAccommodation"];
	readonly #quoteTtlSeconds: number;
	readonly #resolveDiscount: CommerceServiceOptions["resolveDiscount"];
	readonly #resolveConversationGateway: CommerceServiceOptions["resolveConversationGateway"];
	readonly #resolveReservationGateway: CommerceServiceOptions["resolveReservationGateway"];
	readonly #realtimePublisher: RealtimePublisher;
	readonly #refundPayment: CommerceServiceOptions["refundPayment"];
	readonly #retrievePaymentIntent: CommerceServiceOptions["retrievePaymentIntent"];
	readonly #autoRefundOnFailure: boolean;
	readonly #maxReservationAttempts: number;
	readonly #reservationSource: string;

	constructor(options: CommerceServiceOptions) {
		this.#accountId = options.accountId;
		this.#currency = options.currency;
		this.#db = options.db;
		this.#provider = options.provider;
		this.#quoteAccommodation = options.quoteAccommodation;
		this.#quoteTtlSeconds = options.quoteTtlSeconds;
		this.#resolveDiscount = options.resolveDiscount;
		this.#resolveConversationGateway = options.resolveConversationGateway;
		this.#resolveReservationGateway = options.resolveReservationGateway;
		this.#realtimePublisher =
			options.realtimePublisher ?? noopRealtimePublisher;
		this.#refundPayment = options.refundPayment;
		this.#retrievePaymentIntent = options.retrievePaymentIntent;
		this.#autoRefundOnFailure = options.autoRefundOnFailure ?? true;
		this.#maxReservationAttempts =
			options.maxReservationAttempts ?? DEFAULT_MAX_RESERVATION_ATTEMPTS;
		this.#reservationSource =
			options.reservationSource ?? DEFAULT_RESERVATION_SOURCE;
	}

	async createCart(
		input: CreateCartInput,
		owner: CartOwner,
	): Promise<CartResponse> {
		const payload = {
			cartId: input.cartId ?? null,
			userId: owner.userId ?? null,
		};
		const operation = (tx: Transaction) => this.#createCart(tx, input, owner);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				"cart:create",
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async getCart(cartId: string, owner: CartOwner): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		return { cart: await this.#cartDto(this.#db, cartId, new Date()) };
	}

	/**
	 * Re-reads a draft order for payment, authorizing the caller the same way
	 * carts are (the linked user, or the anonymous cart's secret token). The
	 * persisted order is the only authoritative source of the payable amount;
	 * `DraftOrderResponse` deliberately omits it. Throws when the order is
	 * missing, not owned, no longer a draft, or its checkout window has lapsed.
	 */
	async getPayableOrder(
		orderId: string,
		owner: CartOwner,
	): Promise<PayableOrder> {
		const [row] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				cartId: orderTable.cartId,
				cartToken: cartTable.cartToken,
				checkoutExpiresAt: orderTable.checkoutExpiresAt,
				currency: orderTable.currency,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.where(eq(orderTable.id, orderId))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			)
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		// Reserve-first moves a held-but-unpaid order to `pending` before the
		// PaymentIntent is returned, so a checkout resume (or a retry on the same
		// intent) must still treat a `pending` order with no recorded payment as
		// payable. A `pending` order that has already recorded a payment, or any
		// terminal state, is no longer payable.
		const payable =
			row.status === "draft" ||
			(row.status === "pending" && row.amountPaidMinor === 0);
		if (!payable) {
			throw new CommerceError(
				"order_not_payable",
				"This order can no longer be paid.",
				409,
			);
		}

		if (
			row.checkoutExpiresAt &&
			row.checkoutExpiresAt.getTime() <= Date.now()
		) {
			throw new CommerceError(
				"order_expired",
				"This checkout session has expired.",
				410,
			);
		}

		return {
			cartId: row.cartId,
			checkoutExpiresAt: row.checkoutExpiresAt
				? row.checkoutExpiresAt.toISOString()
				: null,
			currency: row.currency,
			orderId: row.id,
			publicReference: row.publicReference,
			status: toOrderBookingStatus(row.status),
			stripePaymentIntentId: row.stripePaymentIntentId,
			totalMinor: row.totalMinor,
		};
	}

	/**
	 * Resolves the payable draft order that a cart was converted into, so a guest
	 * who only kept the cart id (e.g. after a refresh) can resume payment without
	 * the order id. Access is authorized against the cart exactly like `getCart`;
	 * the delegated `getPayableOrder` re-checks ownership and payability. A cart
	 * that has not been converted yet reports no payable order.
	 */
	async getPayableOrderForCart(
		cartId: string,
		owner: CartOwner,
	): Promise<PayableOrder> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		const [row] = await this.#db
			.select({
				convertedOrderId: cartTable.convertedOrderId,
				status: cartTable.status,
			})
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (row?.status !== "converted" || !row.convertedOrderId) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return this.getPayableOrder(row.convertedOrderId, owner);
	}

	/**
	 * Owner-scoped read of a draft order's contact snapshot, used to repaint the
	 * checkout contact form after a reload (the contact is never kept in browser
	 * storage). Authorized the same way as `readOrderStatus`.
	 */
	async getOrderContact(
		publicReference: string,
		owner: CartOwner,
	): Promise<DraftOrderContactInput> {
		const [row] = await this.#db
			.select({
				billingAddress: orderContactTable.billingAddress,
				cartToken: cartTable.cartToken,
				companyName: orderContactTable.companyName,
				email: orderContactTable.email,
				isCompany: orderContactTable.isCompany,
				name: orderContactTable.name,
				notes: orderContactTable.notes,
				phoneE164: orderContactTable.phoneE164,
				taxNumber: orderContactTable.taxNumber,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.leftJoin(orderContactTable, eq(orderContactTable.orderId, orderTable.id))
			.where(eq(orderTable.publicReference, publicReference))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			) ||
			row.email === null ||
			row.name === null ||
			row.phoneE164 === null
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return {
			billingAddress: row.billingAddress ?? {},
			companyName: row.companyName,
			email: row.email,
			isCompany: row.isCompany ?? false,
			name: row.name,
			notes: row.notes,
			phoneE164: row.phoneE164,
			taxNumber: row.taxNumber,
		};
	}

	/**
	 * Updates a draft order's contact snapshot in place. The contact does not
	 * affect the order total, so the PaymentIntent stays valid. Only a `draft`
	 * order may be edited; once paid/failed the contact is frozen.
	 */
	async updateDraftOrderContact(
		publicReference: string,
		owner: CartOwner,
		contact: DraftOrderContactInput,
	): Promise<void> {
		return this.#db.transaction(async (tx) => {
			const [row] = await tx
				.select({
					cartToken: cartTable.cartToken,
					id: orderTable.id,
					status: orderTable.status,
					userId: orderTable.userId,
				})
				.from(orderTable)
				.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
				.where(eq(orderTable.publicReference, publicReference))
				.limit(1)
				.for("update", { of: orderTable });
			if (
				!row ||
				!isOrderAccessGranted(
					{ cartToken: row.cartToken, userId: row.userId },
					owner,
				)
			) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}
			if (row.status !== "draft") {
				throw new CommerceError(
					"order_not_payable",
					"This order can no longer be changed.",
					409,
				);
			}
			await tx
				.update(orderContactTable)
				.set({
					billingAddress: contact.billingAddress,
					companyName: contact.companyName,
					email: contact.email,
					isCompany: contact.isCompany,
					name: contact.name,
					notes: contact.notes,
					phoneE164: contact.phoneE164,
					taxNumber: contact.taxNumber,
				})
				.where(eq(orderContactTable.orderId, row.id));
		});
	}

	/**
	 * Links a Stripe PaymentIntent to its order. Guarded by `IS NULL` so an
	 * idempotent retry (which yields the same intent id) cannot clobber an
	 * existing link, and concurrent writers converge on a single row.
	 */
	async attachPaymentIntentId(
		orderId: string,
		paymentIntentId: string,
	): Promise<void> {
		const [updated] = await this.#db
			.update(orderTable)
			.set({ stripePaymentIntentId: paymentIntentId, updatedAt: new Date() })
			.where(
				and(
					eq(orderTable.id, orderId),
					isNull(orderTable.stripePaymentIntentId),
				),
			)
			.returning({ id: orderTable.id });
		if (updated) return;
		const [existing] = await this.#db
			.select({ stripePaymentIntentId: orderTable.stripePaymentIntentId })
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);
		if (!existing) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}
		if (
			existing.stripePaymentIntentId !== null &&
			existing.stripePaymentIntentId !== paymentIntentId
		) {
			throw new CommerceError(
				"payment_unavailable",
				"Order is already linked to a different payment intent.",
				409,
			);
		}
	}

	/**
	 * Records a verified `payment_intent.succeeded` against an order under the
	 * hold-before-confirm saga. The captured amount/currency are asserted against
	 * the persisted total first: a mismatch returns `amount_mismatch` (the money
	 * was taken, so the caller compensates with a refund). On a match the order is
	 * moved to `pending` with `amountPaidMinor` recorded; it is NOT confirmed here.
	 * Confirmation (and the single confirmation email) happen in
	 * `confirmOrderReservations`, which flips the provider hold from pending to
	 * accepted or compensates when no hold can be confirmed. The guarded UPDATE is
	 * the idempotency authority: a re-delivered event finds a terminal order and
	 * returns `already_finalized`. There is no owner check; the trust boundary is
	 * Stripe's webhook signature.
	 */
	async markOrderPaid(
		orderId: string,
		payment: PaymentAmount,
	): Promise<MarkOrderPaidResult> {
		return this.#db.transaction(async (tx) => {
			const [order] = await tx
				.select({
					currency: orderTable.currency,
					status: orderTable.status,
					totalMinor: orderTable.totalMinor,
				})
				.from(orderTable)
				.where(eq(orderTable.id, orderId))
				.limit(1);

			if (!order) {
				return { outcome: "not_found" };
			}
			if (order.status !== "draft" && order.status !== "pending") {
				return { outcome: "already_finalized" };
			}
			if (
				payment.amountMinor !== order.totalMinor ||
				payment.currency.toUpperCase() !== order.currency.toUpperCase()
			) {
				const [updated] = await tx
					.update(orderTable)
					.set({
						amountPaidMinor: payment.amountMinor,
						failureCode: "amount_mismatch",
						status: "pending",
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(orderTable.id, orderId),
							inArray(orderTable.status, ["draft", "pending"]),
						),
					)
					.returning({ id: orderTable.id });
				if (!updated) {
					return { outcome: "already_finalized" };
				}
				return {
					expected: {
						amountMinor: order.totalMinor,
						currency: order.currency,
					},
					outcome: "amount_mismatch",
					received: payment,
				};
			}

			const [updated] = await tx
				.update(orderTable)
				.set({
					amountPaidMinor: payment.amountMinor,
					status: "pending",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(orderTable.id, orderId),
						inArray(orderTable.status, ["draft", "pending"]),
					),
				)
				.returning({ id: orderTable.id });

			// Lost the race to another finalizer between the read and the guarded
			// update; the order is already settled.
			if (!updated) {
				return { outcome: "already_finalized" };
			}

			return { outcome: "marked" };
		});
	}

	/**
	 * Records a `payment_intent.payment_failed` attempt against a draft/pending
	 * order without finalizing it. A declined or unauthenticated card returns the
	 * PaymentIntent to `requires_payment_method`, so the order stays payable and
	 * the guest can retry on the same intent; only Stripe's failure code/detail is
	 * persisted. The checkout window still gates payability (`order_expired`).
	 * Idempotent like `markOrderPaid`: an already-finalized order is left untouched.
	 */
	async recordOrderPaymentFailure(
		orderId: string,
		failure: OrderPaymentFailureInput,
	): Promise<RecordOrderPaymentFailureResult> {
		const [updated] = await this.#db
			.update(orderTable)
			.set({
				failureCode: failure.failureCode,
				failureDetail: failure.failureDetail,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					inArray(orderTable.status, ["draft", "pending"]),
				),
			)
			.returning({ id: orderTable.id });

		if (updated) {
			return { outcome: "recorded" };
		}

		const [existing] = await this.#db
			.select({ id: orderTable.id })
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);
		if (existing) {
			return { outcome: "already_finalized" };
		}
		return { outcome: "not_found" };
	}

	/**
	 * Owner-scoped read of an order's persisted payment/booking facts for the
	 * completion page. Live PaymentIntent status is resolved by the route from
	 * `stripePaymentIntentId`; this never trusts client-reported payment state.
	 */
	async readOrderStatus(
		publicReference: string,
		owner: CartOwner,
	): Promise<OrderStatusRecord> {
		const [row] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				cartToken: cartTable.cartToken,
				currency: orderTable.currency,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.where(eq(orderTable.publicReference, publicReference))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			)
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return {
			amountPaidMinor: row.amountPaidMinor,
			bookingStatus: toOrderBookingStatus(row.status),
			currency: row.currency,
			orderId: row.id,
			publicReference: row.publicReference,
			stripePaymentIntentId: row.stripePaymentIntentId,
			totalMinor: row.totalMinor,
		};
	}

	/**
	 * Resolves who is acting on an order and what they may do — the spine every
	 * `/order/[reference]` route authorizes through. A member is authorized by the
	 * hashed booking-access token from their redeemed cookie (or a raw `?token=`),
	 * while the original cart-cookie / signed-in-user grants still resolve the
	 * `owner` without a token. A revoked, expired, or unknown token falls through
	 * to the owner grant; if neither path authorizes, the order reports as not
	 * found so its existence stays unenumerable.
	 */
	async resolveOrderAccess(
		reference: string,
		ctx: OrderAccessContext,
	): Promise<ResolvedOrderAccess> {
		const order = await this.#readResolvedOrder(this.#db, reference);
		if (!order) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		if (ctx.memberToken) {
			const [member] = await this.#db
				.select()
				.from(orderMemberTable)
				.where(
					and(
						eq(orderMemberTable.orderId, order.id),
						eq(
							orderMemberTable.accessTokenHash,
							hashMemberToken(ctx.memberToken),
						),
					),
				)
				.limit(1);
			if (
				member &&
				member.status === "active" &&
				!isMemberTokenExpired(member, new Date())
			) {
				return { member, order, role: member.role };
			}
		}

		if (
			isOrderAccessGranted(
				{ cartToken: order.cartToken, userId: order.userId },
				{ cartToken: ctx.cartToken, userId: ctx.userId },
			)
		) {
			const [owner] = await this.#db
				.select()
				.from(orderMemberTable)
				.where(
					and(
						eq(orderMemberTable.orderId, order.id),
						eq(orderMemberTable.role, "owner"),
					),
				)
				.limit(1);
			return { member: owner ?? null, order, role: "owner" };
		}

		throw new CommerceError("order_not_found", "Order not found.", 404);
	}

	/**
	 * Redeems a raw booking-access token against an order: validates its hash,
	 * flips `invited -> active`, binds `user_id` when the visitor is signed in, and
	 * stamps `last_seen_at`. Idempotent — re-redeeming an already-active token
	 * returns the same member. Revoked/expired/unknown tokens report not found.
	 */
	async redeemMemberToken(
		reference: string,
		rawToken: string,
		options: RedeemMemberTokenOptions = {},
	): Promise<ResolvedOrderAccess> {
		return this.#db.transaction(async (tx) => {
			const order = await this.#readResolvedOrder(tx, reference);
			if (!order) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}

			const [member] = await tx
				.select()
				.from(orderMemberTable)
				.where(
					and(
						eq(orderMemberTable.orderId, order.id),
						eq(orderMemberTable.accessTokenHash, hashMemberToken(rawToken)),
					),
				)
				.limit(1)
				.for("update");

			const now = new Date();
			if (
				!member ||
				member.status === "revoked" ||
				isMemberTokenExpired(member, now)
			) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}

			// Acceptance, not invitation, is what capacity caps (invites are unbounded
			// and just expire). Only gate the invited -> active transition; a re-redeem
			// of an already-active token is idempotent and must not be blocked by its
			// own slot. Lock the order row first so concurrent redemptions of the last
			// free slot serialize instead of both winning.
			if (member.status !== "active") {
				await tx
					.select({ id: orderTable.id })
					.from(orderTable)
					.where(eq(orderTable.id, order.id))
					.for("update");

				// Pending invites are unbounded, so two tokens can reach the same
				// person. Reject activation when another active member already
				// represents this recipient — by email, or by the redeeming account —
				// so one person never holds two slots or double-counts against
				// capacity. The order-row lock above serializes these checks.
				const duplicateMatchers = [eq(orderMemberTable.email, member.email)];
				if (options.userId) {
					duplicateMatchers.push(eq(orderMemberTable.userId, options.userId));
				}
				const [duplicate] = await tx
					.select({ id: orderMemberTable.id })
					.from(orderMemberTable)
					.where(
						and(
							eq(orderMemberTable.orderId, order.id),
							eq(orderMemberTable.status, "active"),
							sql`${orderMemberTable.id} <> ${member.id}`,
							or(...duplicateMatchers),
						),
					)
					.limit(1);
				if (duplicate) {
					throw new CommerceError(
						"order_member_exists",
						"That guest already has access to this booking.",
						409,
					);
				}

				const capacity = await this.#orderCapacity(tx, order.id);
				const [activeRow] = await tx
					.select({ value: count() })
					.from(orderMemberTable)
					.where(
						and(
							eq(orderMemberTable.orderId, order.id),
							eq(orderMemberTable.status, "active"),
						),
					);
				if (!canAcceptMember(Number(activeRow?.value ?? 0), capacity)) {
					throw new CommerceError(
						"order_full",
						"This booking is already full.",
						409,
					);
				}
			}

			const [updated] = await tx
				.update(orderMemberTable)
				.set({
					acceptedAt: member.acceptedAt ?? now,
					lastSeenAt: now,
					status: "active",
					userId:
						options.userId && !member.userId ? options.userId : member.userId,
				})
				.where(eq(orderMemberTable.id, member.id))
				.returning();

			return { member: updated ?? member, order, role: member.role };
		});
	}

	/**
	 * Provisions (or rotates) the order's `owner` member and returns a fresh raw
	 * access token. Idempotent: the partial-unique owner index caps an order at one
	 * owner, so a re-run rotates the existing row's token rather than inserting a
	 * second. Bound to the confirmation-email send (the one guarded, once-per-order
	 * action), which both the webhook and the reconciler cron funnel through — so
	 * the raw token reaches whichever path actually mails the link, while only its
	 * hash is ever persisted. Binds the booker's account when the order has one.
	 */
	async issueOwnerAccessToken(
		orderId: string,
		email: string,
	): Promise<IssueMemberTokenResult> {
		return this.#db.transaction(async (tx) => {
			// Lock the order row first so concurrent first-time provisioners serialize:
			// the loser waits, then observes the owner the winner inserted and rotates
			// it, rather than racing into the partial-unique owner violation.
			const [orderRow] = await tx
				.select({ userId: orderTable.userId })
				.from(orderTable)
				.where(eq(orderTable.id, orderId))
				.limit(1)
				.for("update");
			if (!orderRow) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}
			const userId = orderRow.userId ?? null;
			const [existing] = await tx
				.select()
				.from(orderMemberTable)
				.where(
					and(
						eq(orderMemberTable.orderId, orderId),
						eq(orderMemberTable.role, "owner"),
					),
				)
				.limit(1);

			const token = generateMemberToken();
			const now = new Date();
			if (existing) {
				await tx
					.update(orderMemberTable)
					.set({
						accessTokenHash: hashMemberToken(token),
						acceptedAt: existing.acceptedAt ?? now,
						status: "active",
						userId: existing.userId ?? userId,
					})
					.where(eq(orderMemberTable.id, existing.id));
				return { memberId: existing.id, token };
			}

			const memberId = crypto.randomUUID();
			await tx.insert(orderMemberTable).values({
				acceptedAt: now,
				accessTokenHash: hashMemberToken(token),
				createdAt: now,
				email: email.toLowerCase(),
				id: memberId,
				orderId,
				role: "owner",
				status: "active",
				userId,
			});
			return { memberId, token };
		});
	}

	/**
	 * Invites a guest to an order (owner only). Mints an `invited` member with a
	 * 24h token returned once for the magic-link email. Invitations are unbounded
	 * and short-lived; capacity is enforced at acceptance, not here. Rejects a
	 * recipient who already holds active access so a duplicate invite cannot shadow
	 * a real member.
	 */
	async inviteMember(
		access: ResolvedOrderAccess,
		input: { email: string },
		deliver: InviteDelivery,
	): Promise<InviteMemberResult> {
		this.#assertOrderPermission(access, "invite_members");
		const email = input.email.trim().toLowerCase();
		if (!EMAIL_ADDRESS_PATTERN.test(email)) {
			throw invalidRequest("A valid email address is required.", [
				{ message: "Enter a valid email address.", path: "email" },
			]);
		}

		// Reuse a still-pending invite for the same recipient instead of piling up
		// rows on a retry; reject one who already holds active access.
		const [existing] = await this.#db
			.select({ id: orderMemberTable.id, status: orderMemberTable.status })
			.from(orderMemberTable)
			.where(
				and(
					eq(orderMemberTable.orderId, access.order.id),
					eq(orderMemberTable.email, email),
					inArray(orderMemberTable.status, ["active", "invited"]),
				),
			)
			.limit(1);
		if (existing?.status === "active") {
			throw new CommerceError(
				"order_member_exists",
				"That guest already has access to this booking.",
				409,
			);
		}

		const token = generateMemberToken();
		const expiresAt = memberInviteExpiresAt();
		const memberId = existing?.id ?? crypto.randomUUID();

		// Deliver before persisting: a mail-provider failure then leaves no dangling
		// new invite and does not rotate a reused row's live token, so the caller
		// gets a clean error and a safe retry. B1 ships no durable outbox; this
		// ordering is the proportionate guarantee until one exists.
		await deliver({ email, token });

		if (existing) {
			await this.#db
				.update(orderMemberTable)
				.set({ accessTokenHash: hashMemberToken(token), expiresAt })
				.where(eq(orderMemberTable.id, existing.id));
		} else {
			await this.#db.insert(orderMemberTable).values({
				accessTokenHash: hashMemberToken(token),
				createdAt: new Date(),
				email,
				expiresAt,
				id: memberId,
				invitedByMemberId: access.member?.id ?? null,
				orderId: access.order.id,
				role: "member",
				status: "invited",
			});
		}
		trackEvent({
			metadata: { memberId, orderId: access.order.id },
			name: "order_member_invited",
			provider: this.#provider,
			type: "integration",
		});
		return { email, expiresAt, memberId, token };
	}

	/**
	 * Revokes a member's access (owner only). The token dies with the row, so a
	 * revoked member loses access on their next request. The owner cannot be
	 * revoked. Idempotent: re-revoking an already-revoked member is a no-op.
	 */
	async revokeMember(
		access: ResolvedOrderAccess,
		memberId: string,
	): Promise<void> {
		this.#assertOrderPermission(access, "manage_members");
		const member = await this.#loadOrderMember(access.order.id, memberId);
		if (member.role === "owner") {
			throw new CommerceError(
				"order_member_immutable",
				"The booker cannot be removed from the order.",
				409,
			);
		}
		if (member.status === "revoked") {
			return;
		}
		await this.#db
			.update(orderMemberTable)
			.set({ status: "revoked" })
			.where(eq(orderMemberTable.id, member.id));
		trackEvent({
			metadata: { memberId, orderId: access.order.id },
			name: "order_member_revoked",
			provider: this.#provider,
			type: "integration",
		});
	}

	/**
	 * Re-arms an invite (owner only): rotates the token, resets the 24h window, and
	 * returns `invited`. Re-invites a previously revoked member too. An already
	 * accepted member has nothing to resend; the owner's link lives in the
	 * confirmation email, so neither can be resent here.
	 */
	async resendMemberInvite(
		access: ResolvedOrderAccess,
		memberId: string,
		deliver: InviteDelivery,
	): Promise<InviteMemberResult> {
		this.#assertOrderPermission(access, "manage_members");
		const member = await this.#loadOrderMember(access.order.id, memberId);
		if (member.role === "owner") {
			throw new CommerceError(
				"order_member_immutable",
				"The booker's access link is sent with the confirmation email.",
				409,
			);
		}
		if (member.status === "active") {
			throw new CommerceError(
				"order_member_exists",
				"That guest has already accepted the invitation.",
				409,
			);
		}

		const token = generateMemberToken();
		const expiresAt = memberInviteExpiresAt();

		// Deliver first: if the mail provider fails, the member's current token is
		// left untouched (the old link keeps working) and the caller can retry,
		// rather than being stranded with a rotated-but-unsent link.
		await deliver({ email: member.email, token });

		// Re-arm from scratch: clear any acceptance/binding a previously revoked or
		// expired member carried, so the next redemption records a fresh acceptance.
		await this.#db
			.update(orderMemberTable)
			.set({
				acceptedAt: null,
				accessTokenHash: hashMemberToken(token),
				expiresAt,
				lastSeenAt: null,
				status: "invited",
				userId: null,
			})
			.where(eq(orderMemberTable.id, member.id));
		trackEvent({
			metadata: { memberId, orderId: access.order.id },
			name: "order_member_invite_resent",
			provider: this.#provider,
			type: "integration",
		});
		return { email: member.email, expiresAt, memberId: member.id, token };
	}

	/** Loads a member row scoped to an order, throwing 404 when it is not present. */
	async #loadOrderMember(orderId: string, memberId: string) {
		const [member] = await this.#db
			.select()
			.from(orderMemberTable)
			.where(
				and(
					eq(orderMemberTable.id, memberId),
					eq(orderMemberTable.orderId, orderId),
				),
			)
			.limit(1);
		if (!member) {
			throw new CommerceError(
				"order_member_not_found",
				"That guest is not on this booking.",
				404,
			);
		}
		return member;
	}

	/** Sums the order's registrable headcount (guests minus infants) for capacity. */
	async #orderCapacity(tx: DbExecutor, orderId: string): Promise<number> {
		const rows = await tx
			.select({
				guests: accommodationItemDetailTable.guests,
				infants: accommodationItemDetailTable.infants,
			})
			.from(accommodationItemDetailTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, accommodationItemDetailTable.orderItemId),
			)
			.where(eq(orderItemTable.orderId, orderId));
		return orderMemberCapacity(rows);
	}

	/** Throws 403 when a resolved role lacks the permission an operation requires. */
	#assertOrderPermission(
		access: ResolvedOrderAccess,
		permission: OrderPermission,
	): void {
		if (!orderRoleCan(access.role, permission)) {
			throw new CommerceError(
				"order_access_denied",
				"You do not have access to do that.",
				403,
			);
		}
	}

	async readOrderConversations(
		access: ResolvedOrderAccess,
	): Promise<ConversationSummary[]> {
		this.#assertOrderPermission(access, "chat");
		const rows = await this.#db
			.select(conversationSummarySelection)
			.from(conversationTable)
			.where(eq(conversationTable.orderId, access.order.id))
			.orderBy(
				desc(conversationTable.lastMessageAt),
				asc(conversationTable.id),
			);
		return rows.map((row) => this.#toConversationSummary(row));
	}

	async readConversationMessages(
		access: ResolvedOrderAccess,
		conversationId: string,
		options: { limit?: number } = {},
	): Promise<ConversationMessageDto[]> {
		this.#assertOrderPermission(access, "chat");
		await this.#loadConversationForAccess(access, conversationId);
		const limit = Math.min(
			Math.max(options.limit ?? DEFAULT_CONVERSATION_MESSAGE_LIMIT, 1),
			MAX_CONVERSATION_MESSAGE_LIMIT,
		);
		const rows = await this.#db
			.select(conversationMessageSelection)
			.from(conversationMessageTable)
			.where(eq(conversationMessageTable.conversationId, conversationId))
			.orderBy(
				asc(conversationMessageTable.sentAt),
				asc(conversationMessageTable.id),
			)
			.limit(limit);
		return rows.map((row) => this.#toMessageDto(row));
	}

	async sendConversationMessage(
		access: ResolvedOrderAccess,
		conversationId: string,
		input: { body: string },
	): Promise<ConversationMessageDto> {
		this.#assertOrderPermission(access, "chat");
		const body = trimMessageBody(input.body);
		if (body.length === 0) {
			throw invalidRequest("Message body is required.", [
				{ message: "Message body is required.", path: "body" },
			]);
		}

		const conversation = await this.#loadConversationForAccess(
			access,
			conversationId,
		);
		if (conversation.status === "archived" || !conversation.externalThreadId) {
			throw new CommerceError(
				"conversation_unavailable",
				"This conversation is not ready yet.",
				409,
			);
		}

		const now = new Date();
		const [inserted] = await this.#db
			.insert(conversationMessageTable)
			.values({
				body,
				conversationId,
				createdAt: now,
				deliveryStatus: "pending",
				id: crypto.randomUUID(),
				isAutomatic: false,
				senderMemberId: access.member?.id ?? null,
				senderType: "guest",
				sentAt: now,
				updatedAt: now,
			})
			.returning(conversationMessageSelection);
		if (!inserted) {
			throw new CommerceError(
				"conversation_unavailable",
				"Could not create the message.",
				503,
			);
		}

		const pending = this.#toMessageDto(inserted);
		await this.#publishMessageCreatedSafe(
			access.order.id,
			conversationId,
			pending,
		);

		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				pending.id,
				"Conversation gateway is not configured.",
			);
		}

		try {
			const externalMessageId = await gateway.sendMessage(
				conversation.externalThreadId,
				body,
			);
			const delivered = await this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				pending.id,
				externalMessageId,
				now,
			);
			trackEvent({
				metadata: {
					conversationId,
					messageId: delivered.id,
					orderId: access.order.id,
				},
				name: "conversation_message_sent",
				provider: conversation.provider,
				type: "integration",
			});
			return delivered;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			trackEvent({
				metadata: {
					conversationId,
					error: message,
					messageId: pending.id,
					orderId: access.order.id,
				},
				name: "conversation_message_send_failed",
				provider: conversation.provider,
				severity: "warning",
				type: "integration",
			});
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				pending.id,
				message,
			);
		}
	}

	async retryConversationMessage(
		access: ResolvedOrderAccess,
		conversationId: string,
		messageId: string,
	): Promise<ConversationMessageDto> {
		this.#assertOrderPermission(access, "chat");
		const conversation = await this.#loadConversationForAccess(
			access,
			conversationId,
		);
		if (conversation.status === "archived" || !conversation.externalThreadId) {
			throw new CommerceError(
				"conversation_unavailable",
				"This conversation is not ready yet.",
				409,
			);
		}

		const [messageRow] = await this.#db
			.select(conversationMessageSelection)
			.from(conversationMessageTable)
			.where(
				and(
					eq(conversationMessageTable.id, messageId),
					eq(conversationMessageTable.conversationId, conversationId),
					eq(conversationMessageTable.deliveryStatus, "failed"),
				),
			)
			.limit(1);
		if (!messageRow) {
			throw new CommerceError(
				"conversation_message_not_found",
				"Message not found.",
				404,
			);
		}
		if (
			access.role !== "owner" &&
			messageRow.senderMemberId !== access.member?.id
		) {
			throw new CommerceError(
				"order_access_denied",
				"You do not have access to do that.",
				403,
			);
		}

		const [pending] = await this.#db
			.update(conversationMessageTable)
			.set({ deliveryStatus: "pending", updatedAt: new Date() })
			.where(eq(conversationMessageTable.id, messageId))
			.returning(conversationMessageSelection);
		if (pending) {
			await this.#publishMessageCreatedSafe(
				access.order.id,
				conversationId,
				this.#toMessageDto(pending),
			);
		}

		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				messageId,
				"Conversation gateway is not configured.",
			);
		}

		try {
			const externalMessageId = await gateway.sendMessage(
				conversation.externalThreadId,
				messageRow.body,
			);
			return this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				messageId,
				externalMessageId,
				new Date(),
			);
		} catch (error) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				messageId,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	async reconcileConversations(
		options: { limit?: number; now?: Date } = {},
	): Promise<ReconcileConversationsSummary> {
		const now = options.now ?? new Date();
		const limit = options.limit ?? 50;
		const summary: ReconcileConversationsSummary = {
			failed: 0,
			importedMessages: 0,
			linked: 0,
			provisioned: 0,
			scanned: 0,
			synced: 0,
		};

		const missingRows = await this.#db
			.select({
				orderId: orderItemTable.orderId,
				provider: providerBookingTable.provider,
				providerBookingId: providerBookingTable.id,
				providerReservationId: providerBookingTable.providerReservationId,
			})
			.from(providerBookingTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(orderTable, eq(orderTable.id, orderItemTable.orderId))
			.leftJoin(
				conversationTable,
				eq(conversationTable.providerBookingId, providerBookingTable.id),
			)
			.where(
				and(
					eq(orderTable.status, "confirmed"),
					eq(providerBookingTable.normalizedStatus, "confirmed"),
					sql`${providerBookingTable.providerReservationId} is not null`,
					isNull(conversationTable.id),
				),
			)
			.limit(limit);

		for (const row of missingRows) {
			summary.scanned += 1;
			try {
				const provisioned = await this.#provisionConversation(row, now);
				if (provisioned.created) {
					summary.provisioned += 1;
				}
				if (provisioned.linked) {
					summary.linked += 1;
				}
			} catch (error) {
				summary.failed += 1;
				this.#trackConversationReconciliationFailure(
					row.provider,
					row.providerBookingId,
					error,
				);
			}
		}

		const conversationRows = await this.#db
			.select({
				externalThreadId: conversationTable.externalThreadId,
				id: conversationTable.id,
				orderId: conversationTable.orderId,
				provider: conversationTable.provider,
				providerBookingId: conversationTable.providerBookingId,
				status: conversationTable.status,
			})
			.from(conversationTable)
			.where(inArray(conversationTable.status, ["pending", "active"]))
			.orderBy(sql`${conversationTable.lastSyncedAt} asc nulls first`)
			.limit(limit);

		for (const conversation of conversationRows) {
			summary.scanned += 1;
			try {
				const ready =
					conversation.externalThreadId !== null
						? conversation
						: await this.#tryLinkConversation(conversation, now);
				if (ready && ready.externalThreadId !== conversation.externalThreadId) {
					summary.linked += 1;
				}
				if (!ready?.externalThreadId) {
					continue;
				}
				const imported = await this.#syncConversationMessages(
					ready.orderId,
					ready.id,
					ready.provider,
					ready.externalThreadId,
					now,
				);
				summary.importedMessages += imported;
				summary.synced += 1;
			} catch (error) {
				summary.failed += 1;
				this.#trackConversationReconciliationFailure(
					conversation.provider,
					conversation.providerBookingId ?? conversation.id,
					error,
				);
			}
		}

		return summary;
	}

	/**
	 * Aggregates the durable order-hub read model from a resolved access context.
	 * Role drives visibility: the `owner` sees pricing, the tax/billing contact,
	 * the member roster, and per-item money/charges; a `member` sees only the
	 * non-sensitive booking shape (dates, property, statuses, guest-progress
	 * counts). Authorization is the caller's responsibility — pass the result of
	 * {@link resolveOrderAccess}; this never re-checks the token.
	 */
	async readOrderDetail(access: ResolvedOrderAccess): Promise<OrderDetail> {
		const isOwner = access.role === "owner";
		const orderId = access.order.id;

		const [orderRow] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				amountRefundedMinor: orderTable.amountRefundedMinor,
				createdAt: orderTable.createdAt,
				currency: orderTable.currency,
				discountMinor: orderTable.discountMinor,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				subtotalMinor: orderTable.subtotalMinor,
				taxMinor: orderTable.taxMinor,
				totalMinor: orderTable.totalMinor,
			})
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);

		if (!orderRow) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		const itemRows = await this.#db
			.select({
				adults: accommodationItemDetailTable.adults,
				bookingId: providerBookingTable.id,
				bookingNeedsRecovery: providerBookingTable.needsRecovery,
				bookingStatus: providerBookingTable.normalizedStatus,
				checkIn: accommodationItemDetailTable.checkIn,
				checkOut: accommodationItemDetailTable.checkOut,
				children: accommodationItemDetailTable.children,
				currency: orderItemTable.currency,
				discountMinor: orderItemTable.discountMinor,
				guests: accommodationItemDetailTable.guests,
				id: orderItemTable.id,
				imageUrl: orderItemTable.imageUrlSnapshot,
				infants: accommodationItemDetailTable.infants,
				nights: accommodationItemDetailTable.nights,
				pets: accommodationItemDetailTable.pets,
				propertyTimezone: accommodationItemDetailTable.propertyTimezone,
				subtotalMinor: orderItemTable.subtotalMinor,
				taxMinor: orderItemTable.taxMinor,
				title: orderItemTable.titleSnapshot,
				totalMinor: orderItemTable.totalMinor,
				type: orderItemTable.type,
			})
			.from(orderItemTable)
			.leftJoin(
				accommodationItemDetailTable,
				eq(accommodationItemDetailTable.orderItemId, orderItemTable.id),
			)
			.leftJoin(
				providerBookingTable,
				eq(providerBookingTable.orderItemId, orderItemTable.id),
			)
			.where(eq(orderItemTable.orderId, orderId))
			.orderBy(asc(orderItemTable.position));

		const bookingIds = itemRows
			.map((row) => row.bookingId)
			.filter((id): id is string => id !== null);

		const guestRows = bookingIds.length
			? await this.#db
					.select({
						identityStatus: bookingGuestTable.identityStatus,
						providerBookingId: bookingGuestTable.providerBookingId,
					})
					.from(bookingGuestTable)
					.where(inArray(bookingGuestTable.providerBookingId, bookingIds))
			: [];

		const statusesByBooking = new Map<
			string,
			(typeof guestRows)[number]["identityStatus"][]
		>();
		for (const guest of guestRows) {
			const bucket = statusesByBooking.get(guest.providerBookingId) ?? [];
			bucket.push(guest.identityStatus);
			statusesByBooking.set(guest.providerBookingId, bucket);
		}

		const chargesByItem = new Map<string, OrderDetailCharge[]>();
		if (isOwner && itemRows.length > 0) {
			const chargeRows = await this.#db
				.select({
					grossMinor: orderItemChargeTable.grossMinor,
					kind: orderItemChargeTable.kind,
					name: orderItemChargeTable.name,
					orderItemId: orderItemChargeTable.orderItemId,
					position: orderItemChargeTable.position,
					quantity: orderItemChargeTable.quantity,
					taxMinor: orderItemChargeTable.taxMinor,
				})
				.from(orderItemChargeTable)
				.where(
					inArray(
						orderItemChargeTable.orderItemId,
						itemRows.map((row) => row.id),
					),
				)
				.orderBy(asc(orderItemChargeTable.position));
			for (const charge of chargeRows) {
				const bucket = chargesByItem.get(charge.orderItemId) ?? [];
				bucket.push({
					grossMinor: charge.grossMinor,
					kind: charge.kind,
					name: charge.name,
					position: charge.position,
					quantity: charge.quantity,
					taxMinor: charge.taxMinor,
				});
				chargesByItem.set(charge.orderItemId, bucket);
			}
		}

		const items: OrderDetailItem[] = itemRows.map((row) => ({
			adults: row.adults,
			charges: isOwner ? (chargesByItem.get(row.id) ?? []) : null,
			checkIn: row.checkIn,
			checkOut: row.checkOut,
			children: row.children,
			guestProgress: summarizeGuestProgress(
				row.bookingId ? (statusesByBooking.get(row.bookingId) ?? []) : [],
			),
			guests: row.guests,
			id: row.id,
			imageUrl: row.imageUrl,
			infants: row.infants,
			nights: row.nights,
			pets: row.pets,
			pricing: isOwner
				? {
						currency: row.currency,
						discountMinor: row.discountMinor,
						subtotalMinor: row.subtotalMinor,
						taxMinor: row.taxMinor,
						totalMinor: row.totalMinor,
					}
				: null,
			propertyTimezone: row.propertyTimezone,
			providerBooking:
				row.bookingId && row.bookingStatus
					? {
							needsRecovery: row.bookingNeedsRecovery ?? false,
							status: row.bookingStatus,
						}
					: null,
			title: row.title,
			type: row.type,
		}));

		const orderGuestProgress = summarizeGuestProgress(
			guestRows.map((guest) => guest.identityStatus),
		);

		let contact: OrderContactSummary | null = null;
		let members: OrderDetailMember[] | null = null;
		if (isOwner) {
			const [contactRow] = await this.#db
				.select({
					billingAddress: orderContactTable.billingAddress,
					companyName: orderContactTable.companyName,
					email: orderContactTable.email,
					isCompany: orderContactTable.isCompany,
					name: orderContactTable.name,
					notes: orderContactTable.notes,
					phoneE164: orderContactTable.phoneE164,
					taxNumber: orderContactTable.taxNumber,
				})
				.from(orderContactTable)
				.where(eq(orderContactTable.orderId, orderId))
				.limit(1);
			contact = contactRow
				? {
						billingAddress: contactRow.billingAddress,
						companyName: contactRow.companyName,
						email: contactRow.email,
						isCompany: contactRow.isCompany,
						name: contactRow.name,
						notes: contactRow.notes,
						phoneE164: contactRow.phoneE164,
						taxNumber: contactRow.taxNumber,
					}
				: null;

			const memberRows = await this.#db
				.select({
					acceptedAt: orderMemberTable.acceptedAt,
					createdAt: orderMemberTable.createdAt,
					email: orderMemberTable.email,
					id: orderMemberTable.id,
					role: orderMemberTable.role,
					status: orderMemberTable.status,
				})
				.from(orderMemberTable)
				.where(eq(orderMemberTable.orderId, orderId))
				.orderBy(asc(orderMemberTable.createdAt));
			members = memberRows.map((member) => ({
				acceptedAt: member.acceptedAt ? member.acceptedAt.toISOString() : null,
				email: member.email,
				id: member.id,
				invitedAt: member.createdAt.toISOString(),
				isYou: access.member?.id === member.id,
				role: member.role,
				status: member.status,
			}));
		}

		return {
			bookingStatus: toOrderBookingStatus(orderRow.status),
			contact,
			createdAt: orderRow.createdAt.toISOString(),
			conversations: await this.readOrderConversations(access),
			currency: orderRow.currency,
			guestProgress: orderGuestProgress,
			items,
			members,
			pricing: isOwner
				? {
						amountPaidMinor: orderRow.amountPaidMinor,
						amountRefundedMinor: orderRow.amountRefundedMinor,
						currency: orderRow.currency,
						discountMinor: orderRow.discountMinor,
						subtotalMinor: orderRow.subtotalMinor,
						taxMinor: orderRow.taxMinor,
						totalMinor: orderRow.totalMinor,
					}
				: null,
			reference: orderRow.publicReference,
			role: access.role,
		};
	}

	#conversationGatewayFor(
		provider: string,
	): ProviderConversationGateway | null {
		return this.#resolveConversationGateway?.(provider) ?? null;
	}

	#toConversationSummary(row: {
		externalThreadId: string | null;
		id: string;
		lastMessageAt: Date | null;
		lastMessagePreview: string | null;
		providerBookingId: string | null;
		status: ConversationSummary["status"];
		unreadCount: number;
	}): ConversationSummary {
		return {
			externalThreadId: row.externalThreadId,
			id: row.id,
			lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
			lastMessagePreview: row.lastMessagePreview,
			providerBookingId: row.providerBookingId,
			status: row.status,
			unreadCount: row.unreadCount,
		};
	}

	#toMessageDto(row: {
		body: string;
		conversationId: string;
		deliveryStatus: ConversationMessageDto["deliveryStatus"];
		externalMessageId: string | null;
		id: string;
		isAutomatic: boolean;
		readAt: Date | null;
		senderMemberId: string | null;
		senderType: ConversationMessageDto["senderType"];
		sentAt: Date;
	}): ConversationMessageDto {
		return {
			body: row.body,
			conversationId: row.conversationId,
			deliveryStatus: row.deliveryStatus,
			externalMessageId: row.externalMessageId,
			id: row.id,
			isAutomatic: row.isAutomatic,
			readAt: row.readAt?.toISOString() ?? null,
			senderMemberId: row.senderMemberId,
			senderType: row.senderType,
			sentAt: row.sentAt.toISOString(),
		};
	}

	async #loadConversationForAccess(
		access: ResolvedOrderAccess,
		conversationId: string,
	): Promise<{
		externalThreadId: string | null;
		id: string;
		orderId: string;
		provider: string;
		providerBookingId: string | null;
		status: ConversationSummary["status"];
	}> {
		const [conversation] = await this.#db
			.select({
				externalThreadId: conversationTable.externalThreadId,
				id: conversationTable.id,
				orderId: conversationTable.orderId,
				provider: conversationTable.provider,
				providerBookingId: conversationTable.providerBookingId,
				status: conversationTable.status,
			})
			.from(conversationTable)
			.where(
				and(
					eq(conversationTable.id, conversationId),
					eq(conversationTable.orderId, access.order.id),
				),
			)
			.limit(1);
		if (!conversation) {
			throw new CommerceError(
				"conversation_not_found",
				"Conversation not found.",
				404,
			);
		}
		return conversation;
	}

	async #touchConversationPreview(
		orderId: string,
		conversationId: string,
		body: string,
		sentAt: Date,
	): Promise<void> {
		const [summary] = await this.#db
			.update(conversationTable)
			.set({
				lastMessageAt: sentAt,
				lastMessagePreview: normalizeConversationPreview(body),
				updatedAt: new Date(),
			})
			.where(eq(conversationTable.id, conversationId))
			.returning(conversationSummarySelection);
		if (summary) {
			await this.#publishConversationUpdatedSafe(
				orderId,
				conversationId,
				this.#toConversationSummary(summary),
			);
		}
	}

	async #markConversationMessageDelivered(
		orderId: string,
		conversationId: string,
		messageId: string,
		externalMessageId: string | null,
		fallbackSentAt: Date,
	): Promise<ConversationMessageDto> {
		const [updated] = await this.#db
			.update(conversationMessageTable)
			.set({
				deliveryStatus: "sent",
				externalMessageId,
				sentAt: fallbackSentAt,
				updatedAt: new Date(),
			})
			.where(eq(conversationMessageTable.id, messageId))
			.returning(conversationMessageSelection);
		if (!updated) {
			throw new CommerceError(
				"conversation_message_not_found",
				"Message not found.",
				404,
			);
		}
		const dto = this.#toMessageDto(updated);
		await this.#touchConversationPreview(
			orderId,
			conversationId,
			dto.body,
			updated.sentAt,
		);
		await this.#publishMessageCreatedSafe(orderId, conversationId, dto);
		return dto;
	}

	async #markConversationMessageFailed(
		orderId: string,
		conversationId: string,
		messageId: string,
		errorMessage: string,
	): Promise<ConversationMessageDto> {
		const [updated] = await this.#db
			.update(conversationMessageTable)
			.set({
				deliveryStatus: "failed",
				rawPayload: { deliveryError: errorMessage.slice(0, 1000) },
				updatedAt: new Date(),
			})
			.where(eq(conversationMessageTable.id, messageId))
			.returning(conversationMessageSelection);
		if (!updated) {
			throw new CommerceError(
				"conversation_message_not_found",
				"Message not found.",
				404,
			);
		}
		const dto = this.#toMessageDto(updated);
		await this.#touchConversationPreview(
			orderId,
			conversationId,
			dto.body,
			updated.sentAt,
		);
		await this.#publishMessageCreatedSafe(orderId, conversationId, dto);
		return dto;
	}

	async #publishMessageCreatedSafe(
		orderId: string,
		conversationId: string,
		message: ConversationMessageDto,
	): Promise<void> {
		try {
			await this.#realtimePublisher.publishMessageCreated(
				orderId,
				conversationId,
				message,
			);
		} catch (error) {
			this.#trackRealtimePublishFailure(conversationId, error);
		}
	}

	async #publishConversationUpdatedSafe(
		orderId: string,
		conversationId: string,
		conversation: ConversationSummary,
	): Promise<void> {
		try {
			await this.#realtimePublisher.publishConversationUpdated(
				orderId,
				conversationId,
				conversation,
			);
		} catch (error) {
			this.#trackRealtimePublishFailure(conversationId, error);
		}
	}

	async #provisionConversation(
		row: {
			orderId: string;
			provider: string;
			providerBookingId: string;
			providerReservationId: string | null;
		},
		now: Date,
	): Promise<{ created: boolean; linked: boolean }> {
		const gateway = this.#conversationGatewayFor(row.provider);
		const thread =
			gateway && row.providerReservationId
				? await gateway.findThreadForReservation(row.providerReservationId)
				: null;

		const [created] = await this.#db
			.insert(conversationTable)
			.values({
				createdAt: now,
				externalThreadId: thread?.externalThreadId ?? null,
				id: crypto.randomUUID(),
				lastMessagePreview: thread?.lastMessagePreview ?? null,
				orderId: row.orderId,
				provider: row.provider,
				providerBookingId: row.providerBookingId,
				status: thread?.status ?? "pending",
				unreadCount: thread?.unreadCount ?? 0,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: conversationTable.id });

		if (created && thread) {
			trackEvent({
				metadata: {
					conversationId: created.id,
					providerBookingId: row.providerBookingId,
					providerReservationId: row.providerReservationId,
				},
				name: "conversation_linked",
				provider: row.provider,
				type: "integration",
			});
		}

		return { created: Boolean(created), linked: Boolean(created && thread) };
	}

	async #tryLinkConversation(
		conversation: {
			externalThreadId: string | null;
			id: string;
			orderId: string;
			provider: string;
			providerBookingId: string | null;
			status: ConversationSummary["status"];
		},
		now: Date,
	): Promise<typeof conversation | null> {
		if (!conversation.providerBookingId) {
			return conversation;
		}
		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return conversation;
		}
		const [booking] = await this.#db
			.select({
				providerReservationId: providerBookingTable.providerReservationId,
			})
			.from(providerBookingTable)
			.where(eq(providerBookingTable.id, conversation.providerBookingId))
			.limit(1);
		if (!booking?.providerReservationId) {
			return conversation;
		}

		const thread = await gateway.findThreadForReservation(
			booking.providerReservationId,
		);
		if (!thread) {
			return conversation;
		}

		const [updated] = await this.#db
			.update(conversationTable)
			.set({
				externalThreadId: thread.externalThreadId,
				lastMessagePreview: thread.lastMessagePreview,
				status: thread.status,
				unreadCount: thread.unreadCount,
				updatedAt: now,
			})
			.where(eq(conversationTable.id, conversation.id))
			.returning({
				externalThreadId: conversationTable.externalThreadId,
				id: conversationTable.id,
				orderId: conversationTable.orderId,
				provider: conversationTable.provider,
				providerBookingId: conversationTable.providerBookingId,
				status: conversationTable.status,
			});
		return updated ?? conversation;
	}

	async #syncConversationMessages(
		orderId: string,
		conversationId: string,
		provider: string,
		externalThreadId: string,
		now: Date,
	): Promise<number> {
		const gateway = this.#conversationGatewayFor(provider);
		if (!gateway) {
			throw new Error(
				`Conversation gateway is not configured for ${provider}.`,
			);
		}

		const snapshot = await gateway.getThread(externalThreadId);
		let latestMessage: ProviderConversationMessage | null = null;
		let imported = 0;
		for (const message of snapshot.messages) {
			if (
				!latestMessage ||
				message.sentAt.getTime() >= latestMessage.sentAt.getTime()
			) {
				latestMessage = message;
			}
			const result = await this.#upsertProviderMessage(conversationId, message);
			if (result.inserted) {
				imported += 1;
				trackEvent({
					metadata: {
						conversationId,
						externalMessageId: message.externalMessageId,
					},
					name: "conversation_message_received",
					provider,
					type: "integration",
				});
				await this.#publishMessageCreatedSafe(
					orderId,
					conversationId,
					result.message,
				);
			}
		}

		const [summary] = await this.#db
			.update(conversationTable)
			.set({
				lastMessageAt: latestMessage?.sentAt ?? null,
				lastMessagePreview:
					latestMessage?.body !== undefined
						? normalizeConversationPreview(latestMessage.body)
						: snapshot.thread.lastMessagePreview,
				lastSyncedAt: now,
				status: snapshot.thread.status,
				unreadCount: snapshot.thread.unreadCount,
				updatedAt: now,
			})
			.where(eq(conversationTable.id, conversationId))
			.returning(conversationSummarySelection);
		if (summary) {
			await this.#publishConversationUpdatedSafe(
				orderId,
				conversationId,
				this.#toConversationSummary(summary),
			);
		}
		return imported;
	}

	async #upsertProviderMessage(
		conversationId: string,
		message: ProviderConversationMessage,
	): Promise<{ inserted: boolean; message: ConversationMessageDto }> {
		const [existing] = await this.#db
			.select({ id: conversationMessageTable.id })
			.from(conversationMessageTable)
			.where(
				and(
					eq(conversationMessageTable.conversationId, conversationId),
					eq(
						conversationMessageTable.externalMessageId,
						message.externalMessageId,
					),
				),
			)
			.limit(1);
		const now = new Date();
		if (existing) {
			const [updated] = await this.#db
				.update(conversationMessageTable)
				.set({
					body: message.body,
					deliveryStatus: "sent",
					isAutomatic: message.isAutomatic,
					rawPayload: message.raw,
					senderType: message.senderType,
					sentAt: message.sentAt,
					updatedAt: now,
				})
				.where(eq(conversationMessageTable.id, existing.id))
				.returning(conversationMessageSelection);
			if (!updated) {
				throw new CommerceError(
					"conversation_message_not_found",
					"Message not found.",
					404,
				);
			}
			return { inserted: false, message: this.#toMessageDto(updated) };
		}

		const [inserted] = await this.#db
			.insert(conversationMessageTable)
			.values({
				body: message.body,
				conversationId,
				createdAt: now,
				deliveryStatus: "sent",
				externalMessageId: message.externalMessageId,
				id: crypto.randomUUID(),
				isAutomatic: message.isAutomatic,
				rawPayload: message.raw,
				senderType: message.senderType,
				sentAt: message.sentAt,
				updatedAt: now,
			})
			.returning(conversationMessageSelection);
		if (!inserted) {
			throw new CommerceError(
				"conversation_unavailable",
				"Could not import the message.",
				503,
			);
		}
		return { inserted: true, message: this.#toMessageDto(inserted) };
	}

	#trackRealtimePublishFailure(conversationId: string, error: unknown): void {
		trackEvent({
			metadata: {
				conversationId,
				error: error instanceof Error ? error.message : String(error),
			},
			name: "conversation_realtime_publish_failed",
			severity: "warning",
			type: "integration",
		});
	}

	#trackConversationReconciliationFailure(
		provider: string,
		reference: string,
		error: unknown,
	): void {
		trackEvent({
			metadata: {
				error: error instanceof Error ? error.message : String(error),
				reference,
			},
			name: "conversation_reconcile_failed",
			provider,
			severity: "warning",
			type: "integration",
		});
	}

	async #readResolvedOrder(
		db: DbExecutor,
		reference: string,
	): Promise<ResolvedOrder | null> {
		const [row] = await db
			.select({
				cartToken: cartTable.cartToken,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.where(eq(orderTable.publicReference, reference))
			.limit(1);
		return row ?? null;
	}

	/**
	 * Links the anonymous cart identified by `cartToken` to the authenticated
	 * user. Idempotent: re-claiming a cart the user already owns returns it; a
	 * cart owned by someone else (or absent) reports as not found.
	 */
	async claimCart(owner: CartOwner, cartToken: string): Promise<CartResponse> {
		const userId = owner.userId;
		if (!userId) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await tx
				.update(cartTable)
				.set({ updatedAt: now, userId })
				.where(
					and(
						eq(cartTable.cartToken, cartToken),
						isNull(cartTable.userId),
						eq(cartTable.status, "draft"),
					),
				);

			const [row] = await tx
				.select({ id: cartTable.id, userId: cartTable.userId })
				.from(cartTable)
				.where(eq(cartTable.cartToken, cartToken))
				.limit(1);

			if (!row || row.userId !== userId) {
				throw new CommerceError("cart_not_found", "Cart not found.", 404);
			}

			return { cart: await this.#cartDto(tx, row.id, now) };
		});
	}

	async applyDiscount(
		cartId: string,
		input: ApplyDiscountBody,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		const payload = { cartId, code: input.code };
		const scope = `cart:${cartId}:discount:apply`;
		if (input.idempotencyKey) {
			const replay = await this.#readIdempotencyReplay<CartResponse>(
				scope,
				input.idempotencyKey,
				payload,
			);
			if (replay) {
				return replay;
			}
		}

		const discount = await this.#resolveDiscount(input.code);
		if (!discount) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code is not valid.",
				422,
			);
		}

		const operation = (tx: Transaction) =>
			this.#applyDiscount(tx, cartId, discount);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				scope,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async removeDiscount(
		cartId: string,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
			await tx
				.update(cartTable)
				.set({ appliedDiscount: null, discountMinor: 0, updatedAt: now })
				.where(eq(cartTable.id, cartId));
			await this.#recalculateCartTotals(tx, cartId, now);
			return { cart: await this.#cartDto(tx, cartId, now) };
		});
	}

	async addItem(
		cartId: string,
		input: AddCartItemBody,
		owner: CartOwner,
	): Promise<CartMutationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, input };
		const scope = `cart:${cartId}:items:create`;
		const replay = await this.#readIdempotencyReplay<CartMutationResponse>(
			scope,
			input.idempotencyKey,
			payload,
		);
		if (replay) {
			return replay;
		}

		const snapshot = await this.#fetchQuoteSnapshot(input, true);
		return this.#runIdempotent(scope, input.idempotencyKey, payload, (tx) =>
			this.#addItemWithSnapshot(tx, cartId, input, snapshot),
		);
	}

	async updateItem(
		cartId: string,
		itemId: string,
		input: UpdateCartItemBody,
		owner: CartOwner,
	): Promise<CartMutationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, input, itemId };
		const scope = `cart:${cartId}:items:${itemId}:update`;
		const replay = await this.#readIdempotencyReplay<CartMutationResponse>(
			scope,
			input.idempotencyKey,
			payload,
		);
		if (replay) {
			return replay;
		}

		const current = await this.#readActiveItemInput(cartId, itemId);
		const quoteInput = mergeQuoteInput(current.quoteInput, input);
		const snapshot = await this.#fetchQuoteSnapshot(quoteInput, true);

		return this.#runIdempotent(scope, input.idempotencyKey, payload, (tx) =>
			this.#updateItemWithSnapshot(tx, cartId, itemId, snapshot),
		);
	}

	async removeItem(
		cartId: string,
		itemId: string,
		input: DeleteCartItemBody,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, itemId };
		const operation = (tx: Transaction) => this.#removeItem(tx, cartId, itemId);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				`cart:${cartId}:items:${itemId}:delete`,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async validateCart(
		cartId: string,
		owner: CartOwner,
	): Promise<CartValidationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const inputs = await this.#readActiveItemInputs(cartId);
		const { failures, snapshots } = await this.#revalidateItems(inputs);

		return this.#db.transaction(async (tx) => {
			await this.#ensureMutableCart(tx, cartId, new Date(), {
				forUpdate: true,
			});
			await this.#assertActiveItemSet(
				tx,
				cartId,
				inputs.map((input) => input.itemId),
			);
			for (const snapshot of snapshots) {
				await this.#insertQuoteSnapshot(tx, snapshot.snapshot);
				await tx
					.update(cartItemTable)
					.set({
						quoteSnapshotId: snapshot.snapshot.id,
						updatedAt: new Date(),
					})
					.where(eq(cartItemTable.id, snapshot.itemId));
			}
			await this.#recalculateCartTotals(tx, cartId, new Date());

			return {
				cart: await this.#cartDto(tx, cartId, new Date()),
				failures,
				valid: failures.length === 0,
			};
		});
	}

	async createDraftOrder(
		input: DraftOrderBody,
		owner: CartOwner,
	): Promise<DraftOrderResponse> {
		await this.#assertCartAccess(this.#db, input.cartId, owner);
		const payload = {
			cartId: input.cartId,
			contact: input.contact,
		};
		const scope = `checkout:draft-order:${input.cartId}`;

		if (input.idempotencyKey) {
			const replay = await this.#readIdempotencyReplay<DraftOrderResponse>(
				scope,
				input.idempotencyKey,
				payload,
			);
			if (replay) {
				return replay;
			}
		}

		const activeItems = await this.#readActiveItemInputs(input.cartId);
		if (activeItems.length === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one home before checkout.",
				422,
			);
		}

		const { failures, snapshots } = await this.#revalidateItems(activeItems);
		if (failures.length > 0) {
			throw new CommerceError(
				"quote_revalidation_failed",
				"One or more cart items need updated dates or guests.",
				409,
				{
					issues: failures.map((failure) => ({
						message: failure.message,
						path: `items.${failure.itemId}`,
					})),
				},
			);
		}

		const discount = await this.#revalidateCartDiscount(input.cartId);

		const operation = (tx: Transaction) =>
			this.#createDraftOrder(tx, input, snapshots, owner, discount);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				scope,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async #createCart(
		tx: Transaction,
		input: CreateCartInput,
		owner: CartOwner,
	): Promise<CartResponse> {
		const now = new Date();

		if (input.cartId) {
			const [existing] = await tx
				.select({ id: cartTable.id })
				.from(cartTable)
				.where(eq(cartTable.id, input.cartId))
				.limit(1);
			if (existing) {
				// A supplied id must not let a caller adopt someone else's cart.
				await this.#assertCartAccess(tx, existing.id, owner);
				return { cart: await this.#cartDto(tx, existing.id, now) };
			}
		}

		const id = input.cartId ?? crypto.randomUUID();
		await tx.insert(cartTable).values({
			cartToken: crypto.randomUUID(),
			createdAt: now,
			currency: this.#currency,
			expiresAt: new Date(now.getTime() + CART_TTL_MS),
			id,
			updatedAt: now,
			userId: owner.userId ?? null,
		});

		return { cart: await this.#cartDto(tx, id, now) };
	}

	async #addItemWithSnapshot(
		tx: Transaction,
		cartId: string,
		input: AddCartItemBody,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<CartMutationResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		await this.#insertQuoteSnapshot(tx, snapshot);

		const existing = input.clientMutationId
			? await this.#findItemByClientMutationId(
					tx,
					cartId,
					input.clientMutationId,
				)
			: null;
		const itemId = existing?.id ?? crypto.randomUUID();

		if (existing) {
			await tx
				.update(cartItemTable)
				.set({
					quoteSnapshotId: snapshot.id,
					removedAt: null,
					status: "active",
					updatedAt: now,
				})
				.where(eq(cartItemTable.id, itemId));
		} else {
			await tx.insert(cartItemTable).values({
				cartId,
				clientMutationId: input.clientMutationId,
				createdAt: now,
				id: itemId,
				position: await this.#nextCartPosition(tx, cartId),
				quoteSnapshotId: snapshot.id,
				status: "active",
				type: "accommodation",
				updatedAt: now,
			});
		}

		await this.#recalculateCartTotals(tx, cartId, now);
		return this.#cartMutationResponse(tx, cartId, itemId, now);
	}

	async #updateItemWithSnapshot(
		tx: Transaction,
		cartId: string,
		itemId: string,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<CartMutationResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		const [item] = await tx
			.select({ id: cartItemTable.id, status: cartItemTable.status })
			.from(cartItemTable)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (item?.status !== "active") {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		await this.#insertQuoteSnapshot(tx, snapshot);
		await tx
			.update(cartItemTable)
			.set({ quoteSnapshotId: snapshot.id, updatedAt: now })
			.where(eq(cartItemTable.id, itemId));
		await this.#recalculateCartTotals(tx, cartId, now);

		return this.#cartMutationResponse(tx, cartId, itemId, now);
	}

	async #removeItem(
		tx: Transaction,
		cartId: string,
		itemId: string,
	): Promise<CartResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		const [item] = await tx
			.select({ id: cartItemTable.id, status: cartItemTable.status })
			.from(cartItemTable)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (!item) {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		if (item.status !== "removed") {
			await tx
				.update(cartItemTable)
				.set({ removedAt: now, status: "removed", updatedAt: now })
				.where(eq(cartItemTable.id, itemId));
			await this.#recalculateCartTotals(tx, cartId, now);
		}

		return { cart: await this.#cartDto(tx, cartId, now) };
	}

	async #applyDiscount(
		tx: Transaction,
		cartId: string,
		discount: AppliedDiscountSnapshot,
	): Promise<CartResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });

		const [cartRow] = await tx
			.select({ currency: cartTable.currency })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (
			discount.type === "fixed" &&
			discount.currency &&
			cartRow &&
			discount.currency.toUpperCase() !== cartRow.currency.toUpperCase()
		) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code cannot be applied to this cart.",
				422,
			);
		}

		await tx
			.update(cartTable)
			.set({ appliedDiscount: discount, updatedAt: now })
			.where(eq(cartTable.id, cartId));
		await this.#recalculateCartTotals(tx, cartId, now);

		return { cart: await this.#cartDto(tx, cartId, now) };
	}

	/**
	 * Re-resolves the cart's applied coupon against the provider before checkout,
	 * mirroring quote revalidation, so an expired/deactivated code cannot be
	 * charged. Returns the freshly resolved snapshot, or null when no discount is
	 * applied. Throws `discount_invalid` (409) if the code is no longer valid.
	 */
	async #revalidateCartDiscount(
		cartId: string,
	): Promise<RevalidatedCartDiscount> {
		const [row] = await this.#db
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		const applied = row?.appliedDiscount;
		if (!applied) {
			return { applied: null, resolved: null };
		}

		// Without a promotion code we cannot re-resolve; trust the stored snapshot.
		if (!applied.promotionCode) {
			return { applied, resolved: applied };
		}

		const resolved = await this.#resolveDiscount(applied.promotionCode);
		if (!resolved) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code is no longer valid.",
				409,
			);
		}

		return { applied, resolved };
	}

	async #createDraftOrder(
		tx: Transaction,
		input: DraftOrderBody,
		snapshots: RevalidatedSnapshot[],
		owner: CartOwner,
		revalidatedDiscount: RevalidatedCartDiscount,
	): Promise<DraftOrderResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, input.cartId, now, { forUpdate: true });
		await this.#assertCartDiscountUnchanged(
			tx,
			input.cartId,
			revalidatedDiscount.applied,
		);
		await this.#assertActiveItemSet(
			tx,
			input.cartId,
			snapshots.map((snapshot) => snapshot.itemId),
		);

		for (const snapshot of snapshots) {
			await this.#insertQuoteSnapshot(tx, snapshot.snapshot);
			await tx
				.update(cartItemTable)
				.set({
					quoteSnapshotId: snapshot.snapshot.id,
					updatedAt: now,
				})
				.where(eq(cartItemTable.id, snapshot.itemId));
		}

		const totals = await this.#recalculateCartTotals(tx, input.cartId, now);
		// A fully-discounted housing cart can legitimately reach total 0; only an
		// item-less cart is empty. (Skipping the PaymentIntent for a zero total is
		// a Milestone-4 concern.)
		if (totals.validItemCount === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one valid home before checkout.",
				422,
			);
		}

		const orderSources = await this.#orderSources(tx, input.cartId, now);
		if (orderSources.length === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one valid home before checkout.",
				422,
			);
		}

		const housingBases = orderSources.map(
			(source) => source.quote.housingFeeMinor,
		);
		const discount = revalidatedDiscount.resolved;
		const housingBaseTotal = housingBases.reduce((sum, base) => sum + base, 0);
		const discountMinor = discount
			? computeDiscountMinor(discount, housingBaseTotal, totals.currency)
			: 0;
		const discountAllocations = allocateDiscountByHousingBase(
			housingBases,
			discountMinor,
		);

		const orderId = crypto.randomUUID();
		const checkoutExpiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);

		const publicReference = await this.#insertOrderWithUniqueReference(
			tx,
			{
				appliedDiscount: discountMinor > 0 ? discount : null,
				cartId: input.cartId,
				checkoutExpiresAt,
				createdAt: now,
				currency: totals.currency,
				discountMinor,
				id: orderId,
				status: "draft",
				subtotalMinor: totals.subtotalMinor,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor - discountMinor,
				updatedAt: now,
				userId: owner.userId ?? null,
			},
			now,
		);

		await tx.insert(orderContactTable).values({
			billingAddress: input.contact.billingAddress,
			companyName: input.contact.companyName,
			createdAt: now,
			email: input.contact.email,
			id: crypto.randomUUID(),
			isCompany: input.contact.isCompany,
			name: input.contact.name,
			notes: input.contact.notes,
			orderId,
			phoneE164: input.contact.phoneE164,
			taxNumber: input.contact.taxNumber,
		});

		for (const [index, source] of orderSources.entries()) {
			const rows = buildDraftOrderRows(source, input.contact);
			const orderItemId = crypto.randomUUID();
			const itemDiscountMinor = discountAllocations[index] ?? 0;
			const charges =
				discount && itemDiscountMinor > 0
					? [
							...rows.charges,
							buildDiscountChargeRow(
								discount,
								itemDiscountMinor,
								rows.charges.length + 1,
							),
						]
					: rows.charges;

			await tx.insert(orderItemTable).values({
				catalogSnapshot: rows.item.catalogSnapshot,
				createdAt: now,
				currency: rows.item.currency,
				discountMinor: itemDiscountMinor,
				id: orderItemId,
				imageUrlSnapshot: rows.item.imageUrlSnapshot,
				orderId,
				position: rows.item.position,
				quantity: rows.item.quantity,
				sourceCartItemId: rows.item.sourceCartItemId,
				status: rows.item.status,
				subtotalMinor: rows.item.subtotalMinor,
				taxMinor: rows.item.taxMinor,
				titleSnapshot: rows.item.titleSnapshot,
				totalMinor: rows.item.totalMinor - itemDiscountMinor,
				type: rows.item.type,
				updatedAt: now,
			});

			await tx.insert(accommodationItemDetailTable).values({
				adults: rows.detail.adults,
				checkIn: rows.detail.checkIn,
				checkOut: rows.detail.checkOut,
				children: rows.detail.children,
				externalAccountId: rows.detail.externalAccountId,
				guests: rows.detail.guests,
				hostifyListingId: rows.detail.hostifyListingId,
				infants: rows.detail.infants,
				nights: rows.detail.nights,
				orderItemId,
				pets: rows.detail.pets,
				propertyTimezone: rows.detail.propertyTimezone,
				provider: rows.detail.provider,
			});

			const providerBookingId = crypto.randomUUID();
			await tx.insert(providerBookingTable).values({
				createdAt: now,
				externalAccountId: rows.detail.externalAccountId,
				id: providerBookingId,
				normalizedStatus: "pending",
				orderItemId,
				provider: rows.detail.provider,
				stayEndsAt: stayDateToTimestamp(rows.detail.checkOut),
				stayStartsAt: stayDateToTimestamp(rows.detail.checkIn),
				updatedAt: now,
			});

			if (rows.detail.guests > 0) {
				await tx.insert(bookingGuestTable).values(
					Array.from({ length: rows.detail.guests }, (_, position) => ({
						createdAt: now,
						id: crypto.randomUUID(),
						identityStatus: "missing" as const,
						position,
						providerBookingId,
						updatedAt: now,
					})),
				);
			}

			if (charges.length > 0) {
				await tx.insert(orderItemChargeTable).values(
					charges.map((charge) => ({
						createdAt: now,
						grossMinor: charge.grossMinor,
						id: crypto.randomUUID(),
						kind: charge.kind,
						name: charge.name,
						netMinor: charge.netMinor,
						orderItemId,
						position: charge.position,
						providerChargeId: charge.providerChargeId,
						quantity: charge.quantity,
						rawPayload: charge.rawPayload,
						taxMinor: charge.taxMinor,
						taxRateBasisPoints: charge.taxRateBasisPoints,
						unitNetMinor: charge.unitNetMinor,
					})),
				);
			}
		}

		await tx
			.update(cartTable)
			.set({
				convertedOrderId: orderId,
				status: "converted",
				updatedAt: now,
			})
			.where(eq(cartTable.id, input.cartId));

		return {
			checkoutExpiresAt: checkoutExpiresAt.toISOString(),
			orderId,
			publicReference,
			status: "draft",
		};
	}

	async #fetchQuoteSnapshot(
		input: CommerceQuoteInput,
		requireAvailable: boolean,
	): Promise<NormalizedAccommodationQuoteSnapshot> {
		const quote = await this.#quoteAccommodation(input);
		const snapshot = normalizeAccommodationQuoteSnapshot({
			accountId: this.#accountId,
			provider: this.#provider,
			quote,
			ttlSeconds: this.#quoteTtlSeconds,
		});

		if (requireAvailable && snapshot.validationStatus !== "valid") {
			throw new CommerceError(
				"dates_unavailable",
				"These dates are no longer available.",
				409,
			);
		}

		return snapshot;
	}

	async #revalidateItems(inputs: ActiveItemInput[]): Promise<{
		failures: CartValidationFailure[];
		snapshots: RevalidatedSnapshot[];
	}> {
		const failures: CartValidationFailure[] = [];
		const snapshots: RevalidatedSnapshot[] = [];
		type RevalidationAttempt =
			| {
					input: ActiveItemInput;
					snapshot: NormalizedAccommodationQuoteSnapshot;
					type: "snapshot";
			  }
			| { error: CommerceError; input: ActiveItemInput; type: "failure" };

		const results = await Promise.allSettled(
			inputs.map(async (input): Promise<RevalidationAttempt> => {
				try {
					return {
						input,
						snapshot: await this.#fetchQuoteSnapshot(input.quoteInput, false),
						type: "snapshot",
					};
				} catch (error) {
					if (error instanceof CommerceError) {
						return { error, input, type: "failure" };
					}
					throw error;
				}
			}),
		);

		for (const result of results) {
			if (result.status === "rejected") {
				throw result.reason;
			}

			if (result.value.type === "failure") {
				failures.push({
					code: result.value.error.code,
					itemId: result.value.input.itemId,
					message: result.value.error.message,
				});
				continue;
			}

			const { input, snapshot } = result.value;
			snapshots.push({ itemId: input.itemId, snapshot });
			if (snapshot.validationStatus !== "valid") {
				failures.push({
					code: "dates_unavailable",
					itemId: input.itemId,
					message: "These dates are no longer available.",
				});
			}
		}

		return { failures, snapshots };
	}

	async #insertQuoteSnapshot(
		tx: Transaction,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<void> {
		await tx.insert(accommodationQuoteSnapshotTable).values({
			adults: snapshot.adults,
			checkIn: snapshot.checkIn,
			checkOut: snapshot.checkOut,
			children: snapshot.children,
			cleaningFeeMinor: snapshot.cleaningFeeMinor,
			createdAt: new Date(),
			currency: snapshot.currency,
			expiresAt: snapshot.expiresAt,
			externalAccountId: snapshot.externalAccountId,
			feeLines: snapshot.feeLines,
			fetchedAt: snapshot.fetchedAt,
			guests: snapshot.guests,
			housingFeeMinor: snapshot.housingFeeMinor,
			id: snapshot.id,
			infants: snapshot.infants,
			listingExternalId: snapshot.listingExternalId,
			nightlyAverageMinor: snapshot.nightlyAverageMinor,
			nights: snapshot.nights,
			pets: snapshot.pets,
			provider: snapshot.provider,
			providerPayload: snapshot.providerPayload,
			subtotalMinor: snapshot.subtotalMinor,
			taxMinor: snapshot.taxMinor,
			totalMinor: snapshot.totalMinor,
			validationStatus: snapshot.validationStatus,
		});
	}

	/**
	 * Authorizes a cart-scoped operation. Access is granted iff the caller is the
	 * linked user, or the cart is anonymous and the caller presents the matching
	 * secret cart token. Denials throw `cart_not_found` (404) so cart existence
	 * stays unenumerable.
	 */
	async #assertCartAccess(
		db: DbExecutor,
		cartId: string,
		owner: CartOwner,
	): Promise<void> {
		const [row] = await db
			.select({ cartToken: cartTable.cartToken, userId: cartTable.userId })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!row || !isCartAccessGranted(row, owner)) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}
	}

	async #ensureMutableCart(
		db: DbExecutor,
		cartId: string,
		now: Date,
		options: { forUpdate?: boolean } = {},
	): Promise<void> {
		const query = db
			.select({
				expiresAt: cartTable.expiresAt,
				id: cartTable.id,
				status: cartTable.status,
			})
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		// `forUpdate` locks the cart row for the rest of the transaction so the
		// active item set cannot drift between revalidation and conversion.
		const [row] = options.forUpdate ? await query.for("update") : await query;

		assertMutableCart(row, now);
	}

	/**
	 * Reconciles the cart's current active item set against the set that was
	 * revalidated outside the transaction. A concurrent add/remove between the
	 * unlocked read and the locked transaction throws `cart_changed` (409) so the
	 * client retries against fresh state.
	 */
	async #assertActiveItemSet(
		tx: Transaction,
		cartId: string,
		expectedItemIds: string[],
	): Promise<void> {
		const rows = await tx
			.select({ id: cartItemTable.id })
			.from(cartItemTable)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			);

		const actual = new Set(rows.map((row) => row.id));
		const drifted =
			actual.size !== expectedItemIds.length ||
			expectedItemIds.some((itemId) => !actual.has(itemId));

		if (drifted) {
			throw new CommerceError(
				"cart_changed",
				"Your cart changed; please review it and try again.",
				409,
			);
		}
	}

	async #assertCartDiscountUnchanged(
		tx: Transaction,
		cartId: string,
		expected: AppliedDiscountSnapshot | null,
	): Promise<void> {
		const [row] = await tx
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!discountsEqual(row?.appliedDiscount ?? null, expected)) {
			throw new CommerceError(
				"cart_changed",
				"Your cart changed; please review it and try again.",
				409,
			);
		}
	}

	async #readActiveItemInput(
		cartId: string,
		itemId: string,
	): Promise<ActiveItemInput> {
		const now = new Date();
		await this.#ensureMutableCart(this.#db, cartId, now);
		const [row] = await this.#db
			.select({
				adults: accommodationQuoteSnapshotTable.adults,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				children: accommodationQuoteSnapshotTable.children,
				guests: accommodationQuoteSnapshotTable.guests,
				infants: accommodationQuoteSnapshotTable.infants,
				itemId: cartItemTable.id,
				listingId: accommodationQuoteSnapshotTable.listingExternalId,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
				status: cartItemTable.status,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (row?.status !== "active") {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		return {
			itemId: row.itemId,
			quoteInput: {
				adults: row.adults,
				children: row.children,
				dates: {
					checkIn: row.checkIn,
					checkOut: row.checkOut,
					nights: row.nights,
				},
				guests: row.guests,
				infants: row.infants,
				listingId: row.listingId,
				pets: row.pets,
			},
		};
	}

	async #readActiveItemInputs(cartId: string): Promise<ActiveItemInput[]> {
		const now = new Date();
		await this.#ensureMutableCart(this.#db, cartId, now);
		const rows = await this.#db
			.select({
				adults: accommodationQuoteSnapshotTable.adults,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				children: accommodationQuoteSnapshotTable.children,
				guests: accommodationQuoteSnapshotTable.guests,
				infants: accommodationQuoteSnapshotTable.infants,
				itemId: cartItemTable.id,
				listingId: accommodationQuoteSnapshotTable.listingExternalId,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			)
			.orderBy(asc(cartItemTable.position));

		return rows.map((row) => ({
			itemId: row.itemId,
			quoteInput: {
				adults: row.adults,
				children: row.children,
				dates: {
					checkIn: row.checkIn,
					checkOut: row.checkOut,
					nights: row.nights,
				},
				guests: row.guests,
				infants: row.infants,
				listingId: row.listingId,
				pets: row.pets,
			},
		}));
	}

	async #findItemByClientMutationId(
		tx: Transaction,
		cartId: string,
		clientMutationId: string,
	): Promise<{ id: string } | null> {
		const [row] = await tx
			.select({ id: cartItemTable.id })
			.from(cartItemTable)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.clientMutationId, clientMutationId),
				),
			)
			.limit(1);

		return row ?? null;
	}

	async #nextCartPosition(tx: Transaction, cartId: string): Promise<number> {
		const [row] = await tx
			.select({
				position: sql<number>`coalesce(max(${cartItemTable.position}), 0)::int`,
			})
			.from(cartItemTable)
			.where(eq(cartItemTable.cartId, cartId));

		return (row?.position ?? 0) + 1;
	}

	async #recalculateCartTotals(
		tx: Transaction,
		cartId: string,
		now: Date,
	): Promise<ReturnType<typeof sumCartTotals>> {
		const rows = await tx
			.select({
				currency: accommodationQuoteSnapshotTable.currency,
				housingFeeMinor: accommodationQuoteSnapshotTable.housingFeeMinor,
				subtotalMinor: accommodationQuoteSnapshotTable.subtotalMinor,
				taxMinor: accommodationQuoteSnapshotTable.taxMinor,
				totalMinor: accommodationQuoteSnapshotTable.totalMinor,
				validationStatus: accommodationQuoteSnapshotTable.validationStatus,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			);

		const totals = sumCartTotals(rows, this.#currency);
		const [cartRow] = await tx
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		const discountMinor = cartRow?.appliedDiscount
			? computeDiscountMinor(
					cartRow.appliedDiscount,
					totals.housingBaseMinor,
					totals.currency,
				)
			: 0;

		await tx
			.update(cartTable)
			.set({
				currency: totals.currency,
				discountMinor,
				itemCount: totals.totalItems,
				subtotalMinor: totals.subtotalMinor,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor - discountMinor,
				updatedAt: now,
			})
			.where(eq(cartTable.id, cartId));

		return totals;
	}

	async #cartMutationResponse(
		tx: Transaction,
		cartId: string,
		itemId: string,
		now: Date,
	): Promise<CartMutationResponse> {
		const cart = await this.#cartDto(tx, cartId, now);
		const item = cart.items.find((cartItem) => cartItem.id === itemId);
		if (!item) {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		return { cart, item, quote: item.quote };
	}

	async #cartDto(db: DbExecutor, cartId: string, now: Date): Promise<CartDto> {
		const [row] = await db
			.select()
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!row) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		const items = await this.#cartRows(db, cartId);
		const status =
			row.status === "draft" && row.expiresAt.getTime() <= now.getTime()
				? "expired"
				: toCartStatus(row.status);

		return {
			appliedDiscount: row.appliedDiscount,
			cartToken: row.cartToken,
			createdAt: row.createdAt.toISOString(),
			currency: row.currency,
			discountMinor: row.discountMinor,
			expiresAt: row.expiresAt.toISOString(),
			id: row.id,
			itemCount: row.itemCount,
			items: items.map((item) => toCartItemDto(item, now)),
			status,
			subtotalMinor: row.subtotalMinor,
			taxMinor: row.taxMinor,
			totalMinor: row.totalMinor,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	async #cartRows(db: DbExecutor, cartId: string): Promise<CartJoinedRow[]> {
		return db
			.select({
				cartItemId: cartItemTable.id,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				city: accommodationListingTable.city,
				country: accommodationListingTable.country,
				currency: accommodationQuoteSnapshotTable.currency,
				externalAccountId: accommodationQuoteSnapshotTable.externalAccountId,
				feeLines: accommodationQuoteSnapshotTable.feeLines,
				fetchedAt: accommodationQuoteSnapshotTable.fetchedAt,
				guests: accommodationQuoteSnapshotTable.guests,
				housingFeeMinor: accommodationQuoteSnapshotTable.housingFeeMinor,
				imageFallbackName: accommodationListingTable.name,
				infants: accommodationQuoteSnapshotTable.infants,
				itemStatus: cartItemTable.status,
				listingExternalId: accommodationQuoteSnapshotTable.listingExternalId,
				nightlyAverageMinor:
					accommodationQuoteSnapshotTable.nightlyAverageMinor,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
				position: cartItemTable.position,
				processed: accommodationListingTable.processed,
				provider: accommodationQuoteSnapshotTable.provider,
				providerPayload: accommodationQuoteSnapshotTable.providerPayload,
				quoteAdults: accommodationQuoteSnapshotTable.adults,
				quoteChildren: accommodationQuoteSnapshotTable.children,
				quoteCleaningFeeMinor: accommodationQuoteSnapshotTable.cleaningFeeMinor,
				quoteExpiresAt: accommodationQuoteSnapshotTable.expiresAt,
				quoteId: accommodationQuoteSnapshotTable.id,
				quoteStatus: accommodationQuoteSnapshotTable.validationStatus,
				raw: accommodationListingTable.raw,
				subtotalMinor: accommodationQuoteSnapshotTable.subtotalMinor,
				taxMinor: accommodationQuoteSnapshotTable.taxMinor,
				timezone: accommodationListingTable.timezone,
				totalMinor: accommodationQuoteSnapshotTable.totalMinor,
				updatedAt: cartItemTable.updatedAt,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				accommodationListingTable,
				and(
					eq(
						accommodationListingTable.provider,
						accommodationQuoteSnapshotTable.provider,
					),
					eq(
						accommodationListingTable.externalAccountId,
						accommodationQuoteSnapshotTable.externalAccountId,
					),
					eq(
						accommodationListingTable.externalId,
						accommodationQuoteSnapshotTable.listingExternalId,
					),
				),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			)
			.orderBy(asc(cartItemTable.position));
	}

	async #orderSources(
		tx: Transaction,
		cartId: string,
		now: Date,
	): Promise<
		{
			cartItemId: string;
			position: number;
			quote: NormalizedAccommodationQuoteSnapshot;
			snapshot: ListingDisplaySnapshot;
		}[]
	> {
		const rows = await this.#cartRows(tx, cartId);
		const sources = [];

		for (const row of rows) {
			const quote = quoteSnapshotFromRow(row);
			if (
				quote.validationStatus !== "valid" ||
				quote.expiresAt.getTime() <= now.getTime()
			) {
				throw new CommerceError(
					"quote_expired",
					"One or more cart items need a fresh quote.",
					409,
				);
			}

			sources.push({
				cartItemId: row.cartItemId,
				position: row.position,
				quote,
				snapshot: listingSnapshot(row),
			});
		}

		return sources;
	}

	/**
	 * Inserts the order row, generating the public reference at insert time and
	 * letting the unique index settle collisions: a 23505 on a savepoint rolls
	 * back just that attempt (not the outer transaction) and we retry with a
	 * fresh reference. Atomic where a check-then-insert was racy.
	 */
	async #insertOrderWithUniqueReference(
		tx: Transaction,
		values: Omit<typeof orderTable.$inferInsert, "publicReference">,
		now: Date,
	): Promise<string> {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const publicReference = generatePublicOrderReference(now);
			try {
				await tx.transaction(async (savepoint) => {
					await savepoint
						.insert(orderTable)
						.values({ ...values, publicReference });
				});
				return publicReference;
			} catch (error) {
				if (isPublicReferenceConflict(error)) {
					continue;
				}
				throw error;
			}
		}

		throw new CommerceError(
			"order_reference_unavailable",
			"Could not generate a unique order reference.",
			500,
		);
	}

	async #readIdempotencyReplay<T>(
		scope: string,
		key: string,
		payload: unknown,
		db: DbExecutor = this.#db,
	): Promise<T | null> {
		const requestHash = hashIdempotencyRequest(payload);
		const [existing] = await db
			.select({
				requestHash: apiIdempotencyKeyTable.requestHash,
				responseSnapshot: apiIdempotencyKeyTable.responseSnapshot,
				status: apiIdempotencyKeyTable.status,
			})
			.from(apiIdempotencyKeyTable)
			.where(
				and(
					eq(apiIdempotencyKeyTable.scope, scope),
					eq(apiIdempotencyKeyTable.key, key),
					gt(apiIdempotencyKeyTable.expiresAt, new Date()),
				),
			)
			.limit(1);

		if (!existing) {
			return null;
		}

		const expectedHash = Buffer.from(existing.requestHash);
		const actualHash = Buffer.from(requestHash);
		if (
			expectedHash.length !== actualHash.length ||
			!timingSafeEqual(expectedHash, actualHash)
		) {
			throw new CommerceError(
				"idempotency_key_reused",
				"This idempotency key was already used with a different request.",
				409,
			);
		}

		if (existing.status === "completed" && existing.responseSnapshot) {
			return existing.responseSnapshot as T;
		}

		throw new CommerceError(
			"idempotency_in_progress",
			"This idempotent request is still being processed.",
			409,
		);
	}

	async #runIdempotent<T>(
		scope: string,
		key: string,
		payload: unknown,
		operation: (tx: Transaction) => Promise<T>,
	): Promise<T> {
		const requestHash = hashIdempotencyRequest(payload);

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await tx
				.delete(apiIdempotencyKeyTable)
				.where(
					and(
						eq(apiIdempotencyKeyTable.scope, scope),
						eq(apiIdempotencyKeyTable.key, key),
						lte(apiIdempotencyKeyTable.expiresAt, now),
					),
				);

			const [inserted] = await tx
				.insert(apiIdempotencyKeyTable)
				.values({
					createdAt: now,
					expiresAt: idempotencyExpiresAt(now),
					id: crypto.randomUUID(),
					key,
					requestHash,
					scope,
					status: "in_progress",
					updatedAt: now,
				})
				.onConflictDoNothing()
				.returning({ id: apiIdempotencyKeyTable.id });

			if (!inserted) {
				const replay = await this.#readIdempotencyReplay<T>(
					scope,
					key,
					payload,
					tx,
				);
				if (replay) {
					return replay;
				}
				throw new CommerceError(
					"idempotency_in_progress",
					"This idempotent request is still being processed.",
					409,
				);
			}

			const response = await operation(tx);
			await tx
				.update(apiIdempotencyKeyTable)
				.set({
					responseSnapshot: response,
					status: "completed",
					updatedAt: new Date(),
				})
				.where(eq(apiIdempotencyKeyTable.id, inserted.id));

			return response;
		});
	}

	// ---------------------------------------------------------------------------
	// Provider reservation saga (M5, reserve-first). The order-level methods loop
	// over every provider_booking regardless of provider, dispatching through the
	// injected provider-keyed gateway so the orchestrator stays provider-agnostic.
	// Provider network calls happen outside transactions (like quoting); durable
	// state is persisted with guarded UPDATEs so the webhook and cron converge.
	// ---------------------------------------------------------------------------

	/**
	 * Places a provider hold for every item of an order before PaymentIntent
	 * confirmation.
	 * Any item that comes back `unavailable` (or fails permanently) releases the
	 * holds already placed in this pass and fails the order without taking money,
	 * so the gate is: no hold -> no confirmation -> no normal charge. A transient
	 * provider failure leaves the order holdable for the next attempt; the cron
	 * releases anything abandoned. On full success the order moves to `pending`.
	 */
	async holdOrderReservations(orderId: string): Promise<HoldOrderResult> {
		const context = await this.#loadSagaContext(orderId);
		if (!context) {
			return { outcome: "not_holdable" };
		}
		const { order } = context;
		const holdable =
			order.status === "draft" ||
			(order.status === "pending" && order.amountPaidMinor === 0);
		if (!holdable) {
			return { outcome: "not_holdable" };
		}

		let sawTransient = false;
		for (const booking of context.bookings) {
			const result = await this.#createHold(context, booking);
			if (typeof result === "object") {
				await this.#releaseHeldSiblings(context, booking.providerBookingId);
				await this.#failOrder(orderId, "reservation_unavailable");
				return { message: result.unavailable, outcome: "unavailable" };
			}
			if (result === "permanent") {
				await this.#releaseHeldSiblings(context, booking.providerBookingId);
				await this.#failOrder(orderId, "reservation_create_failed");
				return {
					message: "This stay can no longer be booked.",
					outcome: "unavailable",
				};
			}
			if (result === "transient") {
				sawTransient = true;
			}
		}

		if (sawTransient) {
			return { outcome: "transient_error" };
		}

		const [updated] = await this.#db
			.update(orderTable)
			.set({ status: "pending", updatedAt: new Date() })
			.where(
				and(
					eq(orderTable.id, orderId),
					inArray(orderTable.status, ["draft", "pending"]),
					eq(orderTable.amountPaidMinor, 0),
				),
			)
			.returning({ id: orderTable.id });
		if (!updated) {
			return { outcome: "not_holdable" };
		}
		trackEvent({
			metadata: { orderId },
			name: "reservation_provisioned",
			provider: this.#provider,
			type: "integration",
		});
		return { outcome: "held" };
	}

	/**
	 * Confirms every provider hold after a successful payment, then settles the
	 * order. All holds confirmed -> order `confirmed` (+ one confirmation email);
	 * a permanent confirm failure -> `compensateOrder` (refund); a transient
	 * failure leaves the order `pending` for the reconciler cron. Idempotent: a
	 * re-run on an already-confirmed order is a no-op.
	 */
	async confirmOrderReservations(
		orderId: string,
	): Promise<ConfirmOrderReservationsResult> {
		const context = await this.#loadSagaContext(orderId);
		if (!context) {
			return { outcome: "not_applicable" };
		}
		const { order } = context;
		if (order.status !== "pending" || order.amountPaidMinor <= 0) {
			return { outcome: "not_applicable" };
		}

		let sawTransient = false;
		let sawPermanent = false;
		for (const booking of context.bookings) {
			const result = await this.#confirmHold(
				booking,
				order.stripePaymentIntentId,
			);
			if (result === "transient") {
				sawTransient = true;
			} else if (result === "permanent") {
				sawPermanent = true;
			}
		}

		if (sawPermanent) {
			const compensation = await this.compensateOrder(
				orderId,
				"reservation_confirm_failed",
			);
			if (compensation.outcome === "compensated") {
				return {
					compensation: compensation.compensation,
					outcome: "compensated",
				};
			}
			if (compensation.outcome === "manual_recovery") {
				return { outcome: "manual_recovery" };
			}
			return { outcome: "not_applicable" };
		}

		if (sawTransient) {
			return { outcome: "pending_retry" };
		}

		const now = new Date();
		const [updated] = await this.#db
			.update(orderTable)
			.set({
				confirmedAt: now,
				finalizationEmailAttemptCount: 0,
				finalizationEmailKind: "confirmation",
				finalizationEmailLastError: null,
				finalizationEmailNextAttemptAt: now,
				finalizationEmailSentAt: null,
				status: "confirmed",
				updatedAt: now,
			})
			.where(and(eq(orderTable.id, orderId), eq(orderTable.status, "pending")))
			.returning({ id: orderTable.id });
		if (!updated) {
			// A concurrent confirmer won the transition; the email is theirs to send.
			return { outcome: "not_applicable" };
		}

		trackEvent({
			metadata: { orderId },
			name: "order_confirmed",
			provider: this.#provider,
			type: "integration",
		});
		return {
			confirmation: this.#buildConfirmationFacts(context),
			outcome: "confirmed",
		};
	}

	/**
	 * Releases every provider hold for an order (payment failed terminally, or an
	 * abandoned checkout expired) and moves the order to `failed`. A transient
	 * cancel failure leaves the order for the cron to retry.
	 */
	async cancelOrderReservations(
		orderId: string,
		reason: string,
	): Promise<CancelOrderReservationsResult> {
		const context = await this.#loadSagaContext(orderId);
		if (!context) {
			return { outcome: "not_found" };
		}
		const { order } = context;
		if (
			order.status === "failed" ||
			order.status === "cancelled" ||
			order.status === "confirmed"
		) {
			return { outcome: "already_settled" };
		}

		if ((await this.#cancelOrderHolds(context, reason)) === "transient") {
			return { outcome: "pending_retry" };
		}

		const [updated] = await this.#db
			.update(orderTable)
			.set({ status: "failed", updatedAt: new Date() })
			.where(
				and(
					eq(orderTable.id, orderId),
					inArray(orderTable.status, ["draft", "pending"]),
				),
			)
			.returning({ id: orderTable.id });
		return updated ? { outcome: "cancelled" } : { outcome: "already_settled" };
	}

	/**
	 * Compensates a charged order whose booking could not be confirmed: a full
	 * refund of the captured amount, order -> `cancelled`, and every hold
	 * released. Config-gated (D4): when auto-refund is disabled (or no refunder /
	 * intent is wired) the order is flagged `needsRecovery` for an operator
	 * instead. Idempotent: a re-run finds the order already `cancelled`.
	 */
	async compensateOrder(
		orderId: string,
		reason: string,
	): Promise<CompensateOrderResult> {
		const refundPayment = this.#refundPayment;
		const emailKind = compensationEmailKindForReason(reason);
		const prepared = await this.#db.transaction(async (tx) => {
			const context = await this.#loadSagaContext(orderId, tx, {
				lockOrder: true,
			});
			if (!context) {
				return { outcome: "not_found" } as const;
			}
			const { order } = context;
			if (order.status === "cancelled") {
				return { outcome: "already_compensated" } as const;
			}
			const compensable =
				order.amountPaidMinor > 0 &&
				(order.status === "pending" || order.status === "confirmed");
			if (!compensable) {
				return { outcome: "not_found" } as const;
			}

			if (
				!this.#autoRefundOnFailure ||
				!refundPayment ||
				!order.stripePaymentIntentId
			) {
				await this.#flagOrderForRecovery(context, reason, tx);
				trackEvent({
					metadata: { mode: "manual", orderId, reason },
					name: "order_compensated",
					provider: this.#provider,
					severity: "warning",
					type: "integration",
				});
				return { outcome: "manual_recovery" } as const;
			}
			if (order.refundRequestedAt && !order.stripeRefundId) {
				await this.#flagOrderForRecovery(
					context,
					REFUND_STATE_UNKNOWN_FAILURE_DETAIL,
					tx,
				);
				trackEvent({
					metadata: { mode: "refund_state_unknown", orderId, reason },
					name: "order_compensated",
					provider: this.#provider,
					severity: "error",
					type: "integration",
				});
				return { outcome: "manual_recovery" } as const;
			}

			const now = new Date();
			const idempotencyKey =
				order.stripeRefundIdempotencyKey ??
				compensationRefundIdempotencyKey(
					order.id,
					order.stripePaymentIntentId,
					order.amountPaidMinor,
				);

			const [updated] = await tx
				.update(orderTable)
				.set({
					failureCode: reason,
					failureDetail: REFUND_REQUESTED_FAILURE_DETAIL,
					refundRequestedAt: order.refundRequestedAt ?? now,
					stripeRefundIdempotencyKey: idempotencyKey,
					updatedAt: now,
				})
				.where(
					and(
						eq(orderTable.id, orderId),
						inArray(orderTable.status, ["pending", "confirmed"]),
						or(
							isNull(orderTable.stripeRefundIdempotencyKey),
							eq(orderTable.stripeRefundIdempotencyKey, idempotencyKey),
						),
					),
				)
				.returning({ id: orderTable.id });
			if (!updated) {
				return { outcome: "already_compensated" } as const;
			}

			return {
				amountMinor: order.amountPaidMinor,
				context,
				idempotencyKey,
				outcome: "refund_prepared",
				paymentIntentId: order.stripePaymentIntentId,
			} as const;
		});

		if (prepared.outcome !== "refund_prepared") {
			return prepared;
		}
		if (!refundPayment) {
			return { outcome: "manual_recovery" };
		}

		const refund = await refundPayment({
			amountMinor: prepared.amountMinor,
			idempotencyKey: prepared.idempotencyKey,
			paymentIntentId: prepared.paymentIntentId,
			reason: "requested_by_customer",
		});

		const result = await this.#db.transaction(async (tx) => {
			const now = new Date();
			const [updated] = await tx
				.update(orderTable)
				.set({
					amountRefundedMinor: refund.amountMinor,
					cancelledAt: now,
					failureCode: reason,
					failureDetail: REFUND_COMPLETED_FAILURE_DETAIL,
					finalizationEmailAttemptCount: 0,
					finalizationEmailKind: emailKind,
					finalizationEmailLastError: null,
					finalizationEmailNextAttemptAt: now,
					finalizationEmailSentAt: null,
					refundCompletedAt: now,
					status: "cancelled",
					stripeRefundId: refund.id,
					stripeRefundIdempotencyKey: prepared.idempotencyKey,
					updatedAt: now,
				})
				.where(
					and(
						eq(orderTable.id, orderId),
						inArray(orderTable.status, ["pending", "confirmed"]),
						eq(orderTable.stripeRefundIdempotencyKey, prepared.idempotencyKey),
					),
				)
				.returning({ id: orderTable.id });
			if (!updated) {
				return { outcome: "already_compensated" } as const;
			}

			await this.#scheduleCompensationHoldRelease(prepared.context, now, tx);

			return {
				compensation: {
					amountRefundedMinor: refund.amountMinor,
					currency: prepared.context.order.currency,
					email: prepared.context.contact?.email ?? "",
					emailKind,
					name: prepared.context.contact?.name ?? "",
					orderId,
					publicReference: prepared.context.order.publicReference,
					reason,
				},
				context: prepared.context,
				outcome: "compensated",
				refund,
			} as const;
		});

		if (result.outcome !== "compensated") {
			return result;
		}

		await this.#cancelOrderHolds(result.context, reason);

		trackEvent({
			metadata: {
				amountRefundedMinor: result.refund.amountMinor,
				orderId,
				reason,
			},
			name: "order_compensated",
			provider: this.#provider,
			severity: "warning",
			type: "integration",
		});

		return {
			compensation: result.compensation,
			outcome: "compensated",
		};
	}

	async markFinalizationEmailSent(
		orderId: string,
		kind: OrderFinalizationEmailKind,
	): Promise<void> {
		const now = new Date();
		await this.#db
			.update(orderTable)
			.set({
				finalizationEmailLastError: null,
				finalizationEmailSentAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					eq(orderTable.finalizationEmailKind, kind),
					isNull(orderTable.finalizationEmailSentAt),
				),
			);
	}

	async claimFinalizationEmail(
		orderId: string,
		kind: OrderFinalizationEmailKind,
	): Promise<boolean> {
		const now = new Date();
		const claimExpiresAt = new Date(
			now.getTime() + FINALIZATION_EMAIL_CLAIM_MS,
		);
		const [updated] = await this.#db
			.update(orderTable)
			.set({
				finalizationEmailNextAttemptAt: claimExpiresAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					eq(orderTable.finalizationEmailKind, kind),
					isNull(orderTable.finalizationEmailSentAt),
					lte(orderTable.finalizationEmailNextAttemptAt, now),
				),
			)
			.returning({ id: orderTable.id });
		return Boolean(updated);
	}

	async recordFinalizationEmailFailure(
		orderId: string,
		kind: OrderFinalizationEmailKind,
		errorMessage: string,
	): Promise<void> {
		const [order] = await this.#db
			.select({
				attemptCount: orderTable.finalizationEmailAttemptCount,
			})
			.from(orderTable)
			.where(
				and(
					eq(orderTable.id, orderId),
					eq(orderTable.finalizationEmailKind, kind),
					isNull(orderTable.finalizationEmailSentAt),
				),
			)
			.limit(1);
		if (!order) {
			return;
		}

		const now = new Date();
		const attemptCount = order.attemptCount + 1;
		await this.#db
			.update(orderTable)
			.set({
				finalizationEmailAttemptCount: attemptCount,
				finalizationEmailLastError: errorMessage.slice(0, 1000),
				finalizationEmailNextAttemptAt: this.#finalizationEmailBackoffFrom(
					now,
					attemptCount,
				),
				updatedAt: now,
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					eq(orderTable.finalizationEmailKind, kind),
					isNull(orderTable.finalizationEmailSentAt),
				),
			);
	}

	async recordFinalizationEmailSentStateFailure(
		orderId: string,
		kind: OrderFinalizationEmailKind,
		errorMessage: string,
	): Promise<void> {
		const now = new Date();
		await this.#db
			.update(orderTable)
			.set({
				finalizationEmailLastError:
					`Email was sent, but marking it sent failed: ${errorMessage}`.slice(
						0,
						1000,
					),
				finalizationEmailSentAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					eq(orderTable.finalizationEmailKind, kind),
					isNull(orderTable.finalizationEmailSentAt),
				),
			);
	}

	/**
	 * One reconciler pass (the durability authority behind the webhook). Pass A
	 * resolves due holds: paid pending orders confirm, unpaid pending orders read
	 * live PaymentIntent state, and terminal orders keep retrying provider hold
	 * release. Pass B releases holds on `draft` orders whose checkout window has
	 * lapsed, the cleanup for abandoned reserve-first holds. Returns counters for
	 * the route to log.
	 */
	async reconcileReservations(
		options: {
			limit?: number;
			now?: Date;
			onCompensated?: (facts: OrderCompensationFacts) => Promise<void>;
			onConfirmed?: (facts: OrderConfirmationFacts) => Promise<void>;
		} = {},
	): Promise<ReconcileReservationsSummary> {
		const now = options.now ?? new Date();
		const limit = options.limit ?? 50;
		const handlers = {
			onCompensated: options.onCompensated,
			onConfirmed: options.onConfirmed,
		};
		const summary: ReconcileReservationsSummary = {
			cancelled: 0,
			compensated: 0,
			confirmed: 0,
			expired: 0,
			rescheduled: 0,
			scanned: 0,
		};

		const duePending = await this.#db
			.selectDistinct({ orderId: orderItemTable.orderId })
			.from(providerBookingTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(orderTable, eq(orderTable.id, orderItemTable.orderId))
			.where(
				and(
					inArray(orderTable.status, ["pending", "cancelled", "failed"]),
					or(
						and(
							eq(orderTable.status, "pending"),
							gt(orderTable.amountPaidMinor, 0),
							eq(providerBookingTable.normalizedStatus, "confirmed"),
						),
						and(
							eq(providerBookingTable.normalizedStatus, "pending"),
							eq(providerBookingTable.needsRecovery, false),
						),
						and(
							eq(providerBookingTable.normalizedStatus, "failed"),
							sql`${providerBookingTable.providerReservationId} is not null`,
							or(
								eq(providerBookingTable.needsRecovery, false),
								and(
									eq(orderTable.status, "pending"),
									sql`${orderTable.failureCode} is distinct from 'manual_recovery'`,
								),
							),
						),
					),
					lte(providerBookingTable.nextAttemptAt, now),
				),
			)
			.limit(limit);

		for (const { orderId } of duePending) {
			summary.scanned += 1;
			try {
				await this.#reconcilePendingOrder(orderId, now, summary, handlers);
			} catch (error) {
				await this.#rescheduleOrderReconciliation(orderId, now);
				summary.rescheduled += 1;
				this.#trackOrderReconciliationFailure(orderId, error);
			}
		}

		const abandonedCutoff = new Date(now.getTime() - ABANDONED_HOLD_GRACE_MS);
		const expiredDrafts = await this.#db
			.selectDistinct({ orderId: orderItemTable.orderId })
			.from(providerBookingTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(orderTable, eq(orderTable.id, orderItemTable.orderId))
			.where(
				and(
					eq(orderTable.status, "draft"),
					eq(orderTable.amountPaidMinor, 0),
					lte(orderTable.checkoutExpiresAt, abandonedCutoff),
					eq(providerBookingTable.normalizedStatus, "pending"),
					sql`${providerBookingTable.providerReservationId} is not null`,
				),
			)
			.limit(limit);

		for (const { orderId } of expiredDrafts) {
			summary.scanned += 1;
			try {
				const result = await this.cancelOrderReservations(
					orderId,
					"checkout_expired",
				);
				if (result.outcome === "cancelled") {
					summary.expired += 1;
				}
			} catch (error) {
				await this.#rescheduleOrderReconciliation(orderId, now);
				summary.rescheduled += 1;
				this.#trackOrderReconciliationFailure(orderId, error);
			}
		}

		await this.#dispatchDueFinalizationEmails(now, limit, handlers);

		return summary;
	}

	async #dispatchDueFinalizationEmails(
		now: Date,
		limit: number,
		handlers: ReconcileHandlers,
	): Promise<void> {
		const dueKinds: OrderFinalizationEmailKind[] = [];
		if (handlers.onConfirmed) {
			dueKinds.push("confirmation");
		}
		if (handlers.onCompensated) {
			dueKinds.push("refund_amount_mismatch", "refund_unconfirmed");
		}
		if (dueKinds.length === 0) {
			return;
		}
		const dueEmails = await this.#db
			.select({
				kind: orderTable.finalizationEmailKind,
				orderId: orderTable.id,
			})
			.from(orderTable)
			.where(
				and(
					inArray(orderTable.finalizationEmailKind, dueKinds),
					isNull(orderTable.finalizationEmailSentAt),
					lte(orderTable.finalizationEmailNextAttemptAt, now),
				),
			)
			.limit(limit);

		for (const { kind, orderId } of dueEmails) {
			if (!isFinalizationEmailKind(kind)) {
				continue;
			}
			try {
				await this.#dispatchPendingFinalizationEmail(orderId, handlers);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await this.recordFinalizationEmailFailure(orderId, kind, message);
				trackEvent({
					metadata: { error: message, emailKind: kind, orderId },
					name: "order_email_dispatch_failed",
					provider: this.#provider,
					severity: "warning",
					type: "integration",
				});
			}
		}
	}

	async #dispatchPendingFinalizationEmail(
		orderId: string,
		handlers: ReconcileHandlers,
	): Promise<void> {
		const context = await this.#loadSagaContext(orderId);
		if (!context || context.order.finalizationEmailSentAt !== null) {
			return;
		}

		if (context.order.finalizationEmailKind === "confirmation") {
			await this.#dispatchConfirmationEmail(
				this.#buildConfirmationFacts(context),
				handlers,
			);
			return;
		}

		if (isCompensationEmailKind(context.order.finalizationEmailKind)) {
			await this.#dispatchCompensationEmail(
				this.#buildCompensationFacts(
					context,
					context.order.finalizationEmailKind,
					context.order.failureCode ?? context.order.finalizationEmailKind,
				),
				handlers,
			);
		}
	}

	async #reconcilePendingOrder(
		orderId: string,
		now: Date,
		summary: ReconcileReservationsSummary,
		handlers: ReconcileHandlers,
	): Promise<void> {
		const [order] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				checkoutExpiresAt: orderTable.checkoutExpiresAt,
				currency: orderTable.currency,
				failureCode: orderTable.failureCode,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
			})
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);
		if (!order) {
			return;
		}

		if (order.status === "cancelled" || order.status === "failed") {
			const context = await this.#loadSagaContext(orderId);
			if (!context) {
				return;
			}
			const result = await this.#cancelOrderHolds(
				context,
				order.status === "cancelled"
					? "compensation_release_retry"
					: "order_release_retry",
			);
			if (result === "transient") {
				summary.rescheduled += 1;
			} else {
				summary.cancelled += 1;
			}
			return;
		}
		if (order.status !== "pending") {
			return;
		}

		// Already-paid pending order: the hold confirm just did not complete.
		if (order.amountPaidMinor > 0) {
			if (order.failureCode === "amount_mismatch") {
				const compensated = await this.compensateOrder(
					orderId,
					"amount_mismatch",
				);
				if (compensated.outcome === "compensated") {
					summary.compensated += 1;
					await this.#dispatchCompensationEmail(
						compensated.compensation,
						handlers,
					);
				}
				return;
			}
			await this.#applyConfirmOutcome(orderId, summary, handlers);
			return;
		}

		const expired =
			order.checkoutExpiresAt !== null &&
			order.checkoutExpiresAt.getTime() + ABANDONED_HOLD_GRACE_MS <=
				now.getTime();

		// Unpaid pending order: trust the live PaymentIntent over the missing webhook.
		if (this.#retrievePaymentIntent && order.stripePaymentIntentId) {
			const live = await this.#retrievePaymentIntent(
				order.stripePaymentIntentId,
			);
			if (live.status === "succeeded") {
				const marked = await this.markOrderPaid(orderId, {
					amountMinor: live.amountMinor,
					currency: live.currency,
				});
				if (marked.outcome === "amount_mismatch") {
					const compensated = await this.compensateOrder(
						orderId,
						"amount_mismatch",
					);
					if (compensated.outcome === "compensated") {
						summary.compensated += 1;
						await this.#dispatchCompensationEmail(
							compensated.compensation,
							handlers,
						);
					}
					return;
				}
				await this.#applyConfirmOutcome(orderId, summary, handlers);
				return;
			}
			if (live.status === "canceled" || expired) {
				const result = await this.cancelOrderReservations(
					orderId,
					"checkout_expired",
				);
				if (result.outcome === "cancelled") {
					summary.expired += 1;
				}
				return;
			}
			await this.#rescheduleBookings(orderId, now);
			summary.rescheduled += 1;
			return;
		}

		if (expired) {
			const result = await this.cancelOrderReservations(
				orderId,
				"checkout_expired",
			);
			if (result.outcome === "cancelled") {
				summary.expired += 1;
			}
			return;
		}

		await this.#rescheduleBookings(orderId, now);
		summary.rescheduled += 1;
	}

	async #applyConfirmOutcome(
		orderId: string,
		summary: ReconcileReservationsSummary,
		handlers: ReconcileHandlers,
	): Promise<void> {
		const result = await this.confirmOrderReservations(orderId);
		if (result.outcome === "confirmed") {
			summary.confirmed += 1;
			await this.#dispatchConfirmationEmail(result.confirmation, handlers);
		} else if (result.outcome === "compensated") {
			summary.compensated += 1;
			await this.#dispatchCompensationEmail(result.compensation, handlers);
		} else if (result.outcome === "pending_retry") {
			summary.rescheduled += 1;
		}
	}

	async #dispatchConfirmationEmail(
		facts: OrderConfirmationFacts,
		handlers: ReconcileHandlers,
	): Promise<void> {
		if (!facts.email) {
			await this.markFinalizationEmailSent(facts.orderId, "confirmation");
			return;
		}
		if (!handlers.onConfirmed) {
			return;
		}
		if (!(await this.claimFinalizationEmail(facts.orderId, "confirmation"))) {
			return;
		}
		try {
			await handlers.onConfirmed(facts);
		} catch (error) {
			await this.recordFinalizationEmailFailure(
				facts.orderId,
				"confirmation",
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		try {
			await this.markFinalizationEmailSent(facts.orderId, "confirmation");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.recordFinalizationEmailSentStateFailure(
				facts.orderId,
				"confirmation",
				message,
			);
			trackEvent({
				metadata: {
					error: message,
					orderId: facts.orderId,
					publicReference: facts.publicReference,
				},
				name: "order_email_sent_state_update_failed",
				provider: this.#provider,
				severity: "error",
				type: "integration",
			});
		}
	}

	async #dispatchCompensationEmail(
		facts: OrderCompensationFacts,
		handlers: ReconcileHandlers,
	): Promise<void> {
		if (!handlers.onCompensated) {
			return;
		}
		if (!(await this.claimFinalizationEmail(facts.orderId, facts.emailKind))) {
			return;
		}
		try {
			await handlers.onCompensated(facts);
		} catch (error) {
			await this.recordFinalizationEmailFailure(
				facts.orderId,
				facts.emailKind,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		try {
			await this.markFinalizationEmailSent(facts.orderId, facts.emailKind);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.recordFinalizationEmailSentStateFailure(
				facts.orderId,
				facts.emailKind,
				message,
			);
			trackEvent({
				metadata: {
					error: message,
					orderId: facts.orderId,
					publicReference: facts.publicReference,
				},
				name: "order_email_sent_state_update_failed",
				provider: this.#provider,
				severity: "error",
				type: "integration",
			});
		}
	}

	#reservationGatewayFor(
		provider: string,
	): ProviderReservationGateway | undefined {
		return this.#resolveReservationGateway?.(provider);
	}

	async #tryBookingMutationLock(
		db: Transaction,
		scope: string,
		providerBookingId: string,
	): Promise<boolean> {
		const result = await db.execute(sql`
			select pg_try_advisory_xact_lock(
				hashtext(${scope}),
				hashtext(${providerBookingId})
			) as locked
		`);
		const [row] = result.rows as { locked: boolean }[];
		return row?.locked === true;
	}

	async #loadBookingMutationState(
		providerBookingId: string,
		db: Transaction,
	): Promise<Pick<
		SagaBooking,
		| "attemptCount"
		| "normalizedStatus"
		| "providerReservationId"
		| "providerTransactionId"
	> | null> {
		const query = db
			.select({
				attemptCount: providerBookingTable.attemptCount,
				normalizedStatus: providerBookingTable.normalizedStatus,
				providerReservationId: providerBookingTable.providerReservationId,
				providerTransactionId: providerBookingTable.providerTransactionId,
			})
			.from(providerBookingTable)
			.where(eq(providerBookingTable.id, providerBookingId))
			.limit(1);
		const [booking] = await query.for("update");
		return booking ?? null;
	}

	#backoffFrom(now: Date, attemptCount: number): Date {
		const delay = Math.min(
			RESERVATION_RETRY_MAX_MS,
			RESERVATION_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
		);
		return new Date(now.getTime() + delay);
	}

	#finalizationEmailBackoffFrom(now: Date, attemptCount: number): Date {
		const delay = Math.min(
			FINALIZATION_EMAIL_RETRY_MAX_MS,
			FINALIZATION_EMAIL_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
		);
		return new Date(now.getTime() + delay);
	}

	async #loadSagaContext(
		orderId: string,
		db: DbExecutor = this.#db,
		options: { lockOrder?: boolean } = {},
	): Promise<SagaContext | null> {
		const orderQuery = db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				amountRefundedMinor: orderTable.amountRefundedMinor,
				checkoutExpiresAt: orderTable.checkoutExpiresAt,
				currency: orderTable.currency,
				finalizationEmailAttemptCount: orderTable.finalizationEmailAttemptCount,
				finalizationEmailKind: orderTable.finalizationEmailKind,
				finalizationEmailNextAttemptAt:
					orderTable.finalizationEmailNextAttemptAt,
				finalizationEmailSentAt: orderTable.finalizationEmailSentAt,
				failureCode: orderTable.failureCode,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				refundRequestedAt: orderTable.refundRequestedAt,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				stripeRefundId: orderTable.stripeRefundId,
				stripeRefundIdempotencyKey: orderTable.stripeRefundIdempotencyKey,
			})
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);
		const [order] = options.lockOrder
			? await orderQuery.for("update")
			: await orderQuery;
		if (!order) {
			return null;
		}

		const [contact] = await db
			.select({
				billingAddress: orderContactTable.billingAddress,
				email: orderContactTable.email,
				name: orderContactTable.name,
				phoneE164: orderContactTable.phoneE164,
			})
			.from(orderContactTable)
			.where(eq(orderContactTable.orderId, orderId))
			.limit(1);

		const bookingRows = await db
			.select({
				attemptCount: providerBookingTable.attemptCount,
				checkIn: accommodationItemDetailTable.checkIn,
				checkOut: accommodationItemDetailTable.checkOut,
				guests: accommodationItemDetailTable.guests,
				hostifyListingId: accommodationItemDetailTable.hostifyListingId,
				imageUrlSnapshot: orderItemTable.imageUrlSnapshot,
				itemTotalMinor: orderItemTable.totalMinor,
				normalizedStatus: providerBookingTable.normalizedStatus,
				orderItemId: orderItemTable.id,
				pets: accommodationItemDetailTable.pets,
				provider: providerBookingTable.provider,
				providerBookingId: providerBookingTable.id,
				providerReservationId: providerBookingTable.providerReservationId,
				providerTransactionId: providerBookingTable.providerTransactionId,
				titleSnapshot: orderItemTable.titleSnapshot,
			})
			.from(providerBookingTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(
				accommodationItemDetailTable,
				eq(accommodationItemDetailTable.orderItemId, orderItemTable.id),
			)
			.where(eq(orderItemTable.orderId, orderId))
			.orderBy(asc(orderItemTable.position));

		const itemIds = bookingRows.map((row) => row.orderItemId);
		const chargeRows = itemIds.length
			? await db
					.select({
						grossMinor: orderItemChargeTable.grossMinor,
						kind: orderItemChargeTable.kind,
						orderItemId: orderItemChargeTable.orderItemId,
						taxMinor: orderItemChargeTable.taxMinor,
					})
					.from(orderItemChargeTable)
					.where(inArray(orderItemChargeTable.orderItemId, itemIds))
			: [];
		const chargesByItem = new Map<string, ReservationChargeInput[]>();
		for (const charge of chargeRows) {
			const list = chargesByItem.get(charge.orderItemId) ?? [];
			list.push({
				grossMinor: charge.grossMinor,
				kind: charge.kind,
				taxMinor: charge.taxMinor,
			});
			chargesByItem.set(charge.orderItemId, list);
		}

		return {
			bookings: bookingRows.map((row) => ({
				...row,
				charges: chargesByItem.get(row.orderItemId) ?? [],
			})),
			contact: contact ?? null,
			order,
		};
	}

	async #createHold(
		context: SagaContext,
		booking: SagaBooking,
	): Promise<HoldItemResult> {
		return this.#db.transaction(async (tx) => {
			const locked = await this.#tryBookingMutationLock(
				tx,
				"reservation_create",
				booking.providerBookingId,
			);
			if (!locked) {
				return "transient";
			}

			const current = await this.#loadBookingMutationState(
				booking.providerBookingId,
				tx,
			);
			if (!current) {
				return "permanent";
			}
			const currentBooking = { ...booking, ...current };
			if (
				currentBooking.providerReservationId &&
				(currentBooking.normalizedStatus === "pending" ||
					currentBooking.normalizedStatus === "confirmed")
			) {
				return "held";
			}

			const gateway = this.#reservationGatewayFor(currentBooking.provider);
			if (!gateway || !context.contact) {
				const exhausted = await this.#recordBookingAttempt(
					currentBooking,
					!gateway
						? "reservation_gateway_unavailable"
						: "reservation_contact_missing",
					!gateway
						? "Reservation gateway is not configured."
						: "Order contact snapshot is missing.",
					tx,
				);
				return exhausted ? "permanent" : "transient";
			}

			const tag = reservationTag(
				context.order.publicReference,
				currentBooking.orderItemId,
			);

			const existing = await gateway.findExistingHold({
				checkIn: currentBooking.checkIn,
				checkOut: currentBooking.checkOut,
				listingId: currentBooking.hostifyListingId,
				tag,
			});
			if (existing) {
				if (
					(await this.#persistHoldPlaced(
						currentBooking.providerBookingId,
						existing,
						tx,
					)) !== "conflict"
				) {
					return "held";
				}
				await this.#markBookingFailed(
					currentBooking.providerBookingId,
					"hold_persist_conflict",
					`Provider reservation ${existing.reservationId} is already linked to another booking.`,
					tx,
				);
				return "permanent";
			}

			const result = await gateway.placeHold(
				buildHoldRequest({
					charges: currentBooking.charges,
					contact: {
						email: context.contact.email,
						name: context.contact.name,
						phone: context.contact.phoneE164,
					},
					currency: context.order.currency,
					detail: {
						checkIn: currentBooking.checkIn,
						checkOut: currentBooking.checkOut,
						guests: currentBooking.guests,
						hostifyListingId: currentBooking.hostifyListingId,
						pets: currentBooking.pets,
					},
					itemTotalMinor: currentBooking.itemTotalMinor,
					orderItemId: currentBooking.orderItemId,
					publicReference: context.order.publicReference,
					source: this.#reservationSource,
				}),
			);

			switch (result.kind) {
				case "created": {
					const hold = {
						providerStatus: result.providerStatus,
						raw: result.raw,
						reservationId: result.reservationId,
						transactionId: result.transactionId,
					};
					const persistResult = await this.#persistHoldPlaced(
						currentBooking.providerBookingId,
						hold,
						tx,
					);
					if (persistResult === "persisted") {
						return "held";
					}
					if (persistResult === "already_linked") {
						const release = await gateway.cancelHold({
							reason: "duplicate_hold_lost_race",
							reservationId: hold.reservationId,
							transactionId: hold.transactionId,
						});
						if (release.kind !== "ok") {
							trackEvent({
								metadata: {
									orderId: context.order.id,
									providerBookingId: currentBooking.providerBookingId,
									providerReservationId: hold.reservationId,
									reason: release.message,
								},
								name: "duplicate_reservation_release_failed",
								provider: this.#provider,
								severity: "warning",
								type: "integration",
							});
						}
						return "held";
					}
					const release = await gateway.cancelHold({
						reason: "hold_persist_conflict",
						reservationId: hold.reservationId,
						transactionId: hold.transactionId,
					});
					await this.#markBookingFailed(
						currentBooking.providerBookingId,
						"hold_persist_conflict",
						release.kind === "ok"
							? `Provider reservation ${hold.reservationId} was released after it could not be linked to this booking.`
							: `Provider reservation ${hold.reservationId} could not be linked to this booking. Manual release may be required.`,
						tx,
					);
					return "permanent";
				}
				case "unavailable":
					await this.#markBookingCancelled(
						currentBooking.providerBookingId,
						"unavailable",
						result.message,
						tx,
					);
					return { unavailable: result.message };
				case "transient":
					return (await this.#recordBookingAttempt(
						currentBooking,
						result.code,
						result.message,
						tx,
					))
						? "permanent"
						: "transient";
				case "permanent":
					await this.#markBookingFailed(
						currentBooking.providerBookingId,
						result.code,
						result.message,
						tx,
					);
					return "permanent";
			}
		});
	}

	async #confirmHold(
		booking: SagaBooking,
		paymentReference: string | null,
	): Promise<MutateItemResult> {
		if (booking.normalizedStatus === "confirmed") {
			return "ok";
		}
		const gateway = this.#reservationGatewayFor(booking.provider);
		if (!gateway) {
			const exhausted = await this.#recordBookingAttempt(
				booking,
				"reservation_gateway_unavailable",
				"Reservation gateway is not configured.",
			);
			return exhausted ? "permanent" : "transient";
		}

		const prepared = await this.#db.transaction(async (tx) => {
			const locked = await this.#tryBookingMutationLock(
				tx,
				"reservation_confirm",
				booking.providerBookingId,
			);
			if (!locked) {
				return "transient";
			}

			const current = await this.#loadBookingMutationState(
				booking.providerBookingId,
				tx,
			);
			if (!current) {
				return "permanent";
			}
			const currentBooking = { ...booking, ...current };
			if (currentBooking.normalizedStatus === "confirmed") {
				return "ok";
			}
			const providerReservationId = currentBooking.providerReservationId;
			if (!providerReservationId) {
				await this.#markBookingFailed(
					currentBooking.providerBookingId,
					"missing_reservation",
					"Cannot confirm a hold that was never placed.",
					tx,
				);
				return "permanent";
			}

			return {
				booking: currentBooking,
				providerReservationId,
				providerTransactionId: currentBooking.providerTransactionId,
			};
		});
		if (typeof prepared === "string") {
			return prepared;
		}

		const result = await gateway.confirmHold({
			paymentReference,
			reservationId: prepared.providerReservationId,
			transactionId: prepared.providerTransactionId,
		});

		return this.#db.transaction(async (tx) => {
			const locked = await this.#tryBookingMutationLock(
				tx,
				"reservation_confirm",
				booking.providerBookingId,
			);
			if (!locked) {
				return "transient";
			}

			const current = await this.#loadBookingMutationState(
				booking.providerBookingId,
				tx,
			);
			if (!current) {
				return "permanent";
			}
			const currentBooking = { ...prepared.booking, ...current };
			if (currentBooking.normalizedStatus === "confirmed") {
				return "ok";
			}
			if (
				!currentBooking.providerReservationId ||
				currentBooking.providerReservationId !== prepared.providerReservationId
			) {
				return "transient";
			}

			if (result.kind === "ok") {
				await this.#markBookingConfirmed(
					currentBooking.providerBookingId,
					result.providerStatus,
					result.raw,
					tx,
				);
				return "ok";
			}
			if (result.kind === "transient") {
				const exhausted = await this.#recordBookingAttempt(
					currentBooking,
					result.code,
					result.message,
					tx,
				);
				// Bounded retries: once the cap is hit, escalate to compensation rather
				// than keep a charged order pending forever.
				return exhausted ? "permanent" : "transient";
			}
			await this.#markBookingFailed(
				currentBooking.providerBookingId,
				result.code,
				result.message,
				tx,
			);
			return "permanent";
		});
	}

	async #cancelHold(
		booking: SagaBooking,
		reason: string,
	): Promise<MutateItemResult> {
		return this.#db.transaction(async (tx) => {
			const locked = await this.#tryBookingMutationLock(
				tx,
				"reservation_cancel",
				booking.providerBookingId,
			);
			if (!locked) {
				return "transient";
			}

			const current = await this.#loadBookingMutationState(
				booking.providerBookingId,
				tx,
			);
			if (!current) {
				return "permanent";
			}
			const currentBooking = { ...booking, ...current };
			if (currentBooking.normalizedStatus === "cancelled") {
				return "ok";
			}
			if (
				currentBooking.normalizedStatus === "failed" &&
				!currentBooking.providerReservationId
			) {
				return "ok";
			}
			if (!currentBooking.providerReservationId) {
				await this.#markBookingCancelled(
					currentBooking.providerBookingId,
					"no_hold",
					reason,
					tx,
				);
				return "ok";
			}
			const gateway = this.#reservationGatewayFor(currentBooking.provider);
			if (!gateway) {
				const exhausted = await this.#recordBookingAttempt(
					currentBooking,
					"reservation_gateway_unavailable",
					"Reservation gateway is not configured.",
					tx,
				);
				return exhausted ? "permanent" : "transient";
			}

			const result = await gateway.cancelHold({
				reason,
				reservationId: currentBooking.providerReservationId,
				transactionId: currentBooking.providerTransactionId,
			});
			if (result.kind === "ok") {
				await this.#markBookingCancelled(
					currentBooking.providerBookingId,
					"cancelled",
					reason,
					tx,
				);
				return "ok";
			}
			if (result.kind === "transient") {
				const exhausted = await this.#recordBookingAttempt(
					currentBooking,
					result.code,
					result.message,
					tx,
				);
				// A hold we cannot release is flagged for an operator but must not block
				// the order from settling to `failed`.
				return exhausted ? "permanent" : "transient";
			}
			await this.#markBookingFailed(
				currentBooking.providerBookingId,
				result.code,
				result.message,
				tx,
			);
			return "permanent";
		});
	}

	async #cancelOrderHolds(
		context: SagaContext,
		reason: string,
	): Promise<"ok" | "transient"> {
		let sawTransient = false;
		const latest = await this.#loadSagaContext(context.order.id);
		for (const booking of latest?.bookings ?? context.bookings) {
			const result = await this.#cancelHold(booking, reason);
			if (result === "transient") {
				sawTransient = true;
			}
		}
		return sawTransient ? "transient" : "ok";
	}

	async #scheduleCompensationHoldRelease(
		context: SagaContext,
		now: Date,
		db: DbExecutor = this.#db,
	): Promise<void> {
		const bookingIds = context.bookings
			.filter(
				(booking) =>
					booking.providerReservationId &&
					booking.normalizedStatus !== "cancelled",
			)
			.map((booking) => booking.providerBookingId);
		if (bookingIds.length === 0) {
			return;
		}
		await db
			.update(providerBookingTable)
			.set({ needsRecovery: false, nextAttemptAt: now, updatedAt: now })
			.where(inArray(providerBookingTable.id, bookingIds));
	}

	async #releaseHeldSiblings(
		context: SagaContext,
		exceptBookingId: string,
	): Promise<void> {
		const latest = await this.#loadSagaContext(context.order.id);
		for (const booking of latest?.bookings ?? context.bookings) {
			if (
				booking.providerBookingId === exceptBookingId ||
				!booking.providerReservationId ||
				booking.normalizedStatus === "cancelled" ||
				booking.normalizedStatus === "failed"
			) {
				continue;
			}
			await this.#cancelHold(booking, "sibling_unavailable");
		}
	}

	async #persistHoldPlaced(
		providerBookingId: string,
		hold: {
			providerStatus: string | null;
			raw: Record<string, unknown>;
			reservationId: string;
			transactionId: string | null;
		},
		db: DbExecutor = this.#db,
	): Promise<PersistHoldPlacedResult> {
		let updated: { providerReservationId: string | null } | undefined;
		try {
			await db.transaction(async (savepoint) => {
				[updated] = await savepoint
					.update(providerBookingTable)
					.set({
						attemptCount: 0,
						lastErrorCode: null,
						lastErrorMessage: null,
						needsRecovery: false,
						nextAttemptAt: new Date(),
						providerCreatedAt: new Date(),
						providerReservationId: hold.reservationId,
						providerStatus: hold.providerStatus,
						providerTransactionId: hold.transactionId,
						rawOperationalPayload: hold.raw,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(providerBookingTable.id, providerBookingId),
							isNull(providerBookingTable.providerReservationId),
						),
					)
					.returning({
						providerReservationId: providerBookingTable.providerReservationId,
					});
			});
			if (updated?.providerReservationId === hold.reservationId) {
				return "persisted";
			}
		} catch (error) {
			if (!isProviderHoldIdentityConflict(error)) {
				throw error;
			}
		}

		const [current] = await db
			.select({
				providerReservationId: providerBookingTable.providerReservationId,
			})
			.from(providerBookingTable)
			.where(eq(providerBookingTable.id, providerBookingId))
			.limit(1);
		if (current?.providerReservationId === hold.reservationId) {
			return "persisted";
		}
		if (current?.providerReservationId) {
			return "already_linked";
		}
		return "conflict";
	}

	async #markBookingConfirmed(
		providerBookingId: string,
		providerStatus: string | null,
		raw: Record<string, unknown>,
		db: DbExecutor = this.#db,
	): Promise<void> {
		await db
			.update(providerBookingTable)
			.set({
				lastErrorCode: null,
				lastErrorMessage: null,
				needsRecovery: false,
				nextAttemptAt: new Date(),
				normalizedStatus: "confirmed",
				providerStatus,
				providerUpdatedAt: new Date(),
				rawOperationalPayload: raw,
				updatedAt: new Date(),
			})
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	async #markBookingCancelled(
		providerBookingId: string,
		code: string,
		message: string,
		db: DbExecutor = this.#db,
	): Promise<void> {
		await db
			.update(providerBookingTable)
			.set({
				lastErrorCode: code,
				lastErrorMessage: message,
				needsRecovery: false,
				nextAttemptAt: new Date(),
				normalizedStatus: "cancelled",
				updatedAt: new Date(),
			})
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	async #markBookingFailed(
		providerBookingId: string,
		code: string,
		message: string,
		db: DbExecutor = this.#db,
	): Promise<void> {
		await db
			.update(providerBookingTable)
			.set({
				lastErrorCode: code,
				lastErrorMessage: message,
				needsRecovery: true,
				nextAttemptAt: new Date(),
				normalizedStatus: "failed",
				updatedAt: new Date(),
			})
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	/** Records a retryable attempt; returns true when the retry cap is exhausted. */
	async #recordBookingAttempt(
		booking: SagaBooking,
		code: string,
		message: string,
		db: DbExecutor = this.#db,
	): Promise<boolean> {
		const now = new Date();
		const attemptCount = booking.attemptCount + 1;
		const exhausted = attemptCount >= this.#maxReservationAttempts;
		await db
			.update(providerBookingTable)
			.set({
				attemptCount,
				lastAttemptAt: now,
				lastErrorCode: code,
				lastErrorMessage: message,
				needsRecovery: exhausted,
				nextAttemptAt: exhausted ? now : this.#backoffFrom(now, attemptCount),
				updatedAt: now,
			})
			.where(eq(providerBookingTable.id, booking.providerBookingId));
		return exhausted;
	}

	async #flagOrderForRecovery(
		context: SagaContext,
		reason: string,
		db: DbExecutor = this.#db,
	): Promise<void> {
		const now = new Date();
		await db
			.update(orderTable)
			.set({
				failureCode: "manual_recovery",
				failureDetail: reason,
				updatedAt: now,
			})
			.where(eq(orderTable.id, context.order.id));

		const bookingIds = context.bookings.map(
			(booking) => booking.providerBookingId,
		);
		if (bookingIds.length === 0) {
			return;
		}
		await db
			.update(providerBookingTable)
			.set({
				lastErrorCode: "manual_recovery",
				lastErrorMessage: reason,
				needsRecovery: true,
				updatedAt: now,
			})
			.where(inArray(providerBookingTable.id, bookingIds));
	}

	async #failOrder(orderId: string, reason: string): Promise<void> {
		await this.#db
			.update(orderTable)
			.set({ failureCode: reason, status: "failed", updatedAt: new Date() })
			.where(
				and(
					eq(orderTable.id, orderId),
					inArray(orderTable.status, ["draft", "pending"]),
					eq(orderTable.amountPaidMinor, 0),
				),
			);
	}

	async #rescheduleBookings(orderId: string, now: Date): Promise<void> {
		const next = new Date(now.getTime() + RESERVATION_RETRY_BASE_MS);
		await this.#db
			.update(providerBookingTable)
			.set({ nextAttemptAt: next, updatedAt: now })
			.where(
				and(
					eq(providerBookingTable.normalizedStatus, "pending"),
					eq(providerBookingTable.needsRecovery, false),
					inArray(
						providerBookingTable.orderItemId,
						this.#db
							.select({ id: orderItemTable.id })
							.from(orderItemTable)
							.where(eq(orderItemTable.orderId, orderId)),
					),
				),
			);
	}

	async #rescheduleOrderReconciliation(
		orderId: string,
		now: Date,
	): Promise<void> {
		const next = new Date(now.getTime() + RESERVATION_RETRY_BASE_MS);
		await this.#db
			.update(providerBookingTable)
			.set({ nextAttemptAt: next, updatedAt: now })
			.where(
				and(
					inArray(providerBookingTable.normalizedStatus, [
						"confirmed",
						"failed",
						"pending",
					]),
					eq(providerBookingTable.needsRecovery, false),
					lte(providerBookingTable.nextAttemptAt, now),
					inArray(
						providerBookingTable.orderItemId,
						this.#db
							.select({ id: orderItemTable.id })
							.from(orderItemTable)
							.where(eq(orderItemTable.orderId, orderId)),
					),
				),
			);
	}

	#trackOrderReconciliationFailure(orderId: string, error: unknown): void {
		trackEvent({
			metadata: {
				error: error instanceof Error ? error.message : String(error),
				orderId,
			},
			name: "order_reconciliation_failed",
			provider: this.#provider,
			severity: "warning",
			type: "integration",
		});
	}

	#buildCompensationFacts(
		context: SagaContext,
		emailKind: OrderCompensationEmailKind,
		reason: string,
	): OrderCompensationFacts {
		return {
			amountRefundedMinor: context.order.amountRefundedMinor,
			currency: context.order.currency,
			email: context.contact?.email ?? "",
			emailKind,
			name: context.contact?.name ?? "",
			orderId: context.order.id,
			publicReference: context.order.publicReference,
			reason,
		};
	}

	#buildConfirmationFacts(context: SagaContext): OrderConfirmationFacts {
		const [first] = context.bookings;
		return {
			accommodationImage: first?.imageUrlSnapshot ?? null,
			accommodationTitle: first?.titleSnapshot ?? "Your Alojamento Ideal stay",
			amountPaidMinor: context.order.amountPaidMinor,
			billingAddress: context.contact?.billingAddress ?? {},
			checkIn: first?.checkIn ?? "To be confirmed",
			checkOut: first?.checkOut ?? "To be confirmed",
			contactPhone: context.contact?.phoneE164 ?? "",
			currency: context.order.currency,
			email: context.contact?.email ?? "",
			guests: first?.guests ?? 0,
			name: context.contact?.name ?? "",
			orderId: context.order.id,
			publicReference: context.order.publicReference,
		};
	}
}

function constantTimeEquals(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) {
		return false;
	}
	return timingSafeEqual(aBuffer, bBuffer);
}

function discountsEqual(
	first: AppliedDiscountSnapshot | null,
	second: AppliedDiscountSnapshot | null,
): boolean {
	if (!first || !second) {
		return first === second;
	}

	return (
		first.amountMinor === second.amountMinor &&
		first.couponId === second.couponId &&
		first.currency === second.currency &&
		first.percentBasisPoints === second.percentBasisPoints &&
		first.promotionCode === second.promotionCode &&
		first.source === second.source &&
		first.type === second.type
	);
}

/**
 * Pure access decision for a cart. Granted iff the caller is the linked user,
 * or the cart is anonymous and the caller presents the matching secret token
 * (compared in constant time). Exported for unit testing the access matrix.
 */
export function isCartAccessGranted(
	cart: { cartToken: string; userId: string | null },
	owner: CartOwner,
): boolean {
	if (cart.userId) {
		return owner.userId !== null && owner.userId === cart.userId;
	}
	return (
		owner.cartToken !== null &&
		constantTimeEquals(owner.cartToken, cart.cartToken)
	);
}

/**
 * Access decision for an order. Mirrors {@link isCartAccessGranted}, but the
 * anonymous token is read from the order's originating cart (joined in) and may
 * be absent if that cart was pruned, in which case only the linked user counts.
 */
export function isOrderAccessGranted(
	order: { cartToken: string | null; userId: string | null },
	owner: CartOwner,
): boolean {
	if (order.userId) {
		return owner.userId !== null && owner.userId === order.userId;
	}
	return (
		owner.cartToken !== null &&
		order.cartToken !== null &&
		constantTimeEquals(owner.cartToken, order.cartToken)
	);
}

/** Walks the error cause chain for a Postgres error code + constraint. */
function findPostgresError(
	error: unknown,
): { code: string; constraint?: string } | null {
	let current: unknown = error;
	for (let depth = 0; depth < 6; depth += 1) {
		if (!current || typeof current !== "object") {
			return null;
		}
		const record = current as Record<string, unknown>;
		if (typeof record.code === "string") {
			return {
				code: record.code,
				constraint:
					typeof record.constraint === "string" ? record.constraint : undefined,
			};
		}
		current = record.cause;
	}
	return null;
}

function isPublicReferenceConflict(error: unknown): boolean {
	const pgError = findPostgresError(error);
	return (
		pgError?.code === "23505" &&
		(pgError.constraint === undefined ||
			pgError.constraint === "orders_public_reference_uidx")
	);
}

/** A 23505 on a provider hold identity index means another row owns that id. */
const PROVIDER_HOLD_IDENTITY_CONSTRAINTS = new Set([
	"provider_bookings_provider_reservation_uidx",
	"provider_bookings_provider_reservation_null_account_uidx",
	"provider_bookings_provider_transaction_uidx",
	"provider_bookings_provider_transaction_null_account_uidx",
]);

function isProviderHoldIdentityConflict(error: unknown): boolean {
	const pgError = findPostgresError(error);
	return (
		pgError?.code === "23505" &&
		(pgError.constraint === undefined ||
			PROVIDER_HOLD_IDENTITY_CONSTRAINTS.has(pgError.constraint))
	);
}

function mergeQuoteInput(
	current: CommerceQuoteInput,
	update: UpdateCartItemBody,
): CommerceQuoteInput {
	const parsed = parseQuoteBody({
		adults: update.adults ?? current.adults,
		checkIn: update.checkIn ?? current.dates.checkIn,
		checkOut: update.checkOut ?? current.dates.checkOut,
		children: update.children ?? current.children,
		// Cart-edit reuses cache too; the hold re-checks availability before charge.
		forceFresh: false,
		guests: update.guests ?? current.guests,
		infants: update.infants ?? current.infants,
		listingId: update.listingId ?? current.listingId,
		pets: update.pets ?? current.pets,
	});

	if (!parsed.success) {
		throw invalidRequest(
			"Invalid cart item update",
			parsed.error.issues.map((issue) => ({
				message: issue.message,
				path: issue.path.join("."),
			})),
		);
	}

	return parsed.data;
}

function toCartItemDto(row: CartJoinedRow, now: Date): CartItemDto {
	const snapshot = listingSnapshot(row);
	const quote = quoteDto(row, now);

	return {
		adults: row.quoteAdults,
		checkIn: row.checkIn,
		checkOut: row.checkOut,
		children: row.quoteChildren,
		currency: row.currency,
		guests: row.guests,
		id: row.cartItemId,
		imageUrl: snapshot.imageUrl,
		infants: row.infants,
		listingId: row.listingExternalId,
		nights: row.nights,
		pets: row.pets,
		position: row.position,
		quote,
		status: "active",
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		title: snapshot.title,
		totalMinor: row.totalMinor,
		type: "accommodation",
		updatedAt: row.updatedAt.toISOString(),
	};
}

function quoteDto(row: CartJoinedRow, now: Date): CommerceQuoteDto {
	const status = quoteStatus(row, now);
	return {
		currency: row.currency,
		expiresAt: row.quoteExpiresAt.toISOString(),
		feeLines: row.feeLines,
		fetchedAt: row.fetchedAt.toISOString(),
		id: row.quoteId,
		status,
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
	};
}

function quoteSnapshotFromRow(
	row: CartJoinedRow,
): NormalizedAccommodationQuoteSnapshot {
	return {
		adults: row.quoteAdults,
		checkIn: row.checkIn,
		checkOut: row.checkOut,
		children: row.quoteChildren,
		cleaningFeeMinor: row.quoteCleaningFeeMinor,
		currency: row.currency,
		expiresAt: row.quoteExpiresAt,
		externalAccountId: row.externalAccountId,
		feeLines: row.feeLines,
		fetchedAt: row.fetchedAt,
		guests: row.guests,
		housingFeeMinor: row.housingFeeMinor ?? housingFeeMinor(row.feeLines),
		id: row.quoteId,
		infants: row.infants,
		listingExternalId: row.listingExternalId,
		nightlyAverageMinor: row.nightlyAverageMinor,
		nights: row.nights,
		pets: row.pets,
		provider: row.provider,
		providerPayload: row.providerPayload ?? {},
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
		validationStatus: row.quoteStatus as QuoteValidationStatus,
	};
}

function quoteStatus(row: CartJoinedRow, now: Date): QuoteValidationStatus {
	if (
		row.quoteStatus === "valid" &&
		row.quoteExpiresAt.getTime() <= now.getTime()
	) {
		return "expired";
	}
	if (
		row.quoteStatus === "unavailable" ||
		row.quoteStatus === "provider_error" ||
		row.quoteStatus === "expired"
	) {
		return row.quoteStatus;
	}
	return "valid";
}

function listingSnapshot(row: CartJoinedRow): ListingDisplaySnapshot {
	const title = pickTitle(
		row.processed,
		row.imageFallbackName,
		row.listingExternalId,
	);

	return {
		city: row.city,
		country: row.country,
		imageUrl: extractCoverPhoto(row.raw),
		listingId: row.listingExternalId,
		locationLabel: [row.city, row.country].filter(Boolean).join(", ") || null,
		propertyTimezone: row.timezone ?? DEFAULT_PROPERTY_TIMEZONE,
		provider: row.provider,
		title,
	};
}

function pickTitle(
	processed: AccommodationListingProcessedContent | null,
	fallbackName: string | null,
	listingId: string,
): string {
	const localized = processed?.title;
	return (
		localized?.en?.trim() ||
		localized?.pt?.trim() ||
		localized?.es?.trim() ||
		fallbackName?.trim() ||
		listingId
	);
}

function extractCoverPhoto(
	raw: AccommodationListingRawContent | null,
): string | null {
	if (!raw || !Array.isArray(raw.photos)) {
		return null;
	}

	for (const photo of raw.photos) {
		if (!isRecord(photo)) {
			continue;
		}
		const url = readString(photo.photo) ?? readString(photo.original_file);
		if (url) {
			return url;
		}
	}

	return null;
}

function readString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
