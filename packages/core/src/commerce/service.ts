import { timingSafeEqual } from "node:crypto";
import {
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
	type AppliedDiscountSnapshot,
	accommodationItemDetail as accommodationItemDetailTable,
	accommodationListing as accommodationListingTable,
	accommodationQuoteSnapshot as accommodationQuoteSnapshotTable,
	activityExperience as activityExperienceTable,
	activityItemDetail as activityItemDetailTable,
	activityQuoteSnapshot as activityQuoteSnapshotTable,
	apiIdempotencyKey as apiIdempotencyKeyTable,
	type BookingGuestIdentityStatus,
	bookingGuest as bookingGuestTable,
	type CommerceCatalogSnapshot,
	cartItem as cartItemTable,
	cart as cartTable,
	conversationMessage as conversationMessageTable,
	conversation as conversationTable,
	type Database,
	type OrderBillingAddressSnapshot,
	type OrderMemberStatus,
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
	desc,
	eq,
	gt,
	inArray,
	isNull,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { parseQuoteBody } from "../accommodations";
import type {
	GuestIdentityPrefill,
	IdentityVerificationStatus,
	VerifiedIdentityDocumentFields,
} from "../account";
import {
	decryptIdentityField,
	encryptIdentityField,
} from "../account/identity-encryption";
import { ACTIVITY_PROVIDER } from "../activities/config";
import { nextGuestInfoReminderAt } from "../compliance/guest-reminder";
import type { RefundRequest, RefundResult } from "../integrations/stripe";
import { trackEvent } from "../observability";
import {
	type ConversationMessageDto,
	type ConversationSummary,
	INTERNAL_CONVERSATION_PROVIDER,
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
import {
	type ActivityQuoteResult,
	housingFeeMinor,
	normalizeAccommodationQuoteSnapshot,
	normalizeActivityQuoteSnapshot,
} from "./money";
import {
	generateMemberToken,
	hashMemberToken,
	isMemberTokenExpired,
	memberInviteExpiresAt,
	type OrderAccessContext,
	type OrderPermission,
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
	scopeGuestRowsToViewer,
	scopeOrderItemsToViewer,
	summarizeConversationAvailability,
	summarizeGuestProgress,
} from "./order-detail";
import {
	type BookingGuestAssignment,
	type BookingGuestDetail,
	type BookingGuestIdentityFields,
	type BookingGuestIdentitySessionTarget,
	type BookingGuestList,
	type BookingGuestUpdateInput,
	bookingGuestPurgeAfter,
	identityStatusToBookingGuestStatus,
} from "./order-guests";
import {
	allocateDiscountByHousingBase,
	buildActivityDraftOrderRows,
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
	type OrderPaymentMethodSummary,
	type OrderStatusRecord,
	type PayableOrder,
	type PaymentAmount,
	type PaymentIntentLiveStatus,
	type ReconcileReservationsSummary,
	type RecordOrderPaymentFailureResult,
	toOrderBookingStatus,
	toOrderProvisioningSubState,
} from "./payments";
import {
	type BokunActivityHoldRequest,
	buildHoldRequest,
	type ProviderReservationGateway,
	type ReservationChargeInput,
	reservationTag,
} from "./reservations";
import type {
	AddCartItemBody,
	ApplyDiscountBody,
	DeleteCartItemBody,
	DraftOrderActivityDetailInput,
	DraftOrderBody,
	UpdateCartItemBody,
} from "./schemas";
import { assertMutableCart, toCartStatus } from "./state";
import { findOverlappingStay } from "./stay-overlap";
import { computeDiscountMinor, sumCartTotals } from "./totals";
import type {
	CartDto,
	CartItemDto,
	CartMutationResponse,
	CartOwner,
	CartResponse,
	CartValidationFailure,
	CartValidationResponse,
	CommerceActivityQuoteInput,
	CommerceQuoteDto,
	CommerceQuoteInput,
	DraftOrderContactInput,
	DraftOrderResponse,
	ListingDisplaySnapshot,
	NormalizedAccommodationQuoteSnapshot,
	NormalizedActivityQuoteSnapshot,
	QuoteValidationStatus,
} from "./types";

const CART_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PROPERTY_TIMEZONE = "Europe/Lisbon";

// Reservation-saga retry/backoff bounds (Part A columns drive the cron).
const RESERVATION_RETRY_BASE_MS = 60 * 1000;
const RESERVATION_RETRY_MAX_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RESERVATION_ATTEMPTS = 6;
// A confirmed payment whose accept will not settle on the provider (e.g. Hostify
// refuses to accept a far-future reservation and leaves it pending) is never
// refunded: the hold is alive and the dates are held. After this many not-settled
// reads the booking is flagged `needsRecovery` for an operator and the nudge
// cadence drops to daily until the accept finally takes.
const CONFIRM_SETTLE_GRACE_ATTEMPTS = 6;
const RESERVATION_SETTLE_RETRY_MS = 24 * 60 * 60 * 1000;
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
	provider: conversationTable.provider,
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

const bookingGuestSelection = {
	dateOfBirthEncrypted: bookingGuestTable.dateOfBirthEncrypted,
	documentExpiresOnEncrypted: bookingGuestTable.documentExpiresOnEncrypted,
	documentIssuingCountryEncrypted:
		bookingGuestTable.documentIssuingCountryEncrypted,
	documentNumberEncrypted: bookingGuestTable.documentNumberEncrypted,
	documentTypeEncrypted: bookingGuestTable.documentTypeEncrypted,
	firstNameEncrypted: bookingGuestTable.firstNameEncrypted,
	id: bookingGuestTable.id,
	identityStatus: bookingGuestTable.identityStatus,
	lastNameEncrypted: bookingGuestTable.lastNameEncrypted,
	nationalityEncrypted: bookingGuestTable.nationalityEncrypted,
	orderId: bookingGuestTable.orderId,
	orderMemberId: bookingGuestTable.orderMemberId,
	position: bookingGuestTable.position,
	providerBookingId: bookingGuestTable.providerBookingId,
	purgeAfter: bookingGuestTable.purgeAfter,
	residenceCountryEncrypted: bookingGuestTable.residenceCountryEncrypted,
	stripeVerificationReportId: bookingGuestTable.stripeVerificationReportId,
	stripeVerificationSessionId: bookingGuestTable.stripeVerificationSessionId,
	submittedAt: bookingGuestTable.submittedAt,
	userId: bookingGuestTable.userId,
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
	activityAccountId?: string;
	currency: string;
	db: Database;
	provider: string;
	quoteAccommodation: (
		input: CommerceQuoteInput,
	) => Promise<import("../accommodations").AccommodationQuoteResult>;
	quoteActivity?: (
		input: CommerceActivityQuoteInput,
	) => Promise<ActivityQuoteResult>;
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

interface AccommodationActiveItemInput {
	itemId: string;
	type: "accommodation";
	quoteInput: CommerceQuoteInput;
}

interface ActivityActiveItemInput {
	itemId: string;
	type: "activity";
	quoteInput: CommerceActivityQuoteInput;
}

type ActiveItemInput = AccommodationActiveItemInput | ActivityActiveItemInput;

type ActiveQuoteInput =
	| Omit<AccommodationActiveItemInput, "itemId">
	| Omit<ActivityActiveItemInput, "itemId">;

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
 * Outcome of inviting a guest to a slot. Usually a fresh or rotated `invited`
 * membership carrying the raw token for the magic-link email; when the email
 * already holds `active` access on the order (the same person invited to
 * another booking of a multi-stay order) the slot binds to that membership
 * untouched, so there is no token or expiry to deliver.
 */
interface InviteGuestResult {
	email: string;
	expiresAt: Date | null;
	memberId: string;
	status: "active" | "invited";
	token: string | null;
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

function decryptGuestField(value: Buffer | Uint8Array | null): string | null {
	return value ? decryptIdentityField(value) : null;
}

function encryptGuestField(value: string | null): Buffer | null {
	return value === null ? null : encryptIdentityField(value);
}

function encryptGuestFields(fields: BookingGuestIdentityFields) {
	return {
		dateOfBirthEncrypted: encryptGuestField(fields.dateOfBirth),
		documentExpiresOnEncrypted: encryptGuestField(fields.documentExpiresOn),
		documentIssuingCountryEncrypted: encryptGuestField(
			fields.documentIssuingCountry,
		),
		documentNumberEncrypted: encryptGuestField(fields.documentNumber),
		documentTypeEncrypted: encryptGuestField(fields.documentType),
		firstNameEncrypted: encryptGuestField(fields.firstName),
		lastNameEncrypted: encryptGuestField(fields.lastName),
		nationalityEncrypted: encryptGuestField(fields.nationality),
		residenceCountryEncrypted: encryptGuestField(fields.residenceCountry),
	};
}

function encryptVerifiedGuestField(
	value: string | null,
	existing: Buffer | null,
): Buffer | null {
	return value === null ? existing : encryptIdentityField(value);
}

/**
 * Classifies a guest slot for the owner's view from its bound member row (joined
 * on `booking_guest.order_member_id`). A revoked or absent binding reads as
 * `unassigned` — a slot the owner fills — so a cancelled invite reverts cleanly.
 */
function toGuestAssignment(
	member: {
		email: string;
		expiresAt: Date | null;
		id: string;
		status: OrderMemberStatus;
	} | null,
): BookingGuestAssignment {
	if (!member || member.status === "revoked") {
		return { kind: "unassigned" };
	}
	return {
		email: member.email,
		expiresAt: member.expiresAt ? member.expiresAt.toISOString() : null,
		kind: "member",
		memberId: member.id,
		status: member.status === "active" ? "active" : "invited",
	};
}

function bookingGuestDto(
	row: {
		dateOfBirthEncrypted: Buffer | null;
		documentExpiresOnEncrypted: Buffer | null;
		documentIssuingCountryEncrypted: Buffer | null;
		documentNumberEncrypted: Buffer | null;
		documentTypeEncrypted: Buffer | null;
		firstNameEncrypted: Buffer | null;
		id: string;
		identityStatus: BookingGuestIdentityStatus;
		lastNameEncrypted: Buffer | null;
		nationalityEncrypted: Buffer | null;
		orderMemberId: string | null;
		position: number;
		purgeAfter: Date | null;
		residenceCountryEncrypted: Buffer | null;
		submittedAt: Date | null;
	},
	assignment: BookingGuestAssignment = { kind: "unassigned" },
): BookingGuestDetail {
	return {
		assignment,
		fields: {
			dateOfBirth: decryptGuestField(row.dateOfBirthEncrypted),
			documentExpiresOn: decryptGuestField(row.documentExpiresOnEncrypted),
			documentIssuingCountry: decryptGuestField(
				row.documentIssuingCountryEncrypted,
			),
			documentNumber: decryptGuestField(row.documentNumberEncrypted),
			documentType: decryptGuestField(row.documentTypeEncrypted),
			firstName: decryptGuestField(row.firstNameEncrypted),
			lastName: decryptGuestField(row.lastNameEncrypted),
			nationality: decryptGuestField(row.nationalityEncrypted),
			residenceCountry: decryptGuestField(row.residenceCountryEncrypted),
		},
		id: row.id,
		identityStatus: row.identityStatus,
		orderMemberId: row.orderMemberId,
		position: row.position,
		purgeAfter: row.purgeAfter ? row.purgeAfter.toISOString() : null,
		submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
	};
}

function parseWebhookTimestamp(value: string | null): Date | null {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function nonEmptyPaymentPart(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function normalizePaymentMethodSummary(
	paymentMethod: OrderPaymentMethodSummary | null | undefined,
): OrderPaymentMethodSummary | null {
	const type = nonEmptyPaymentPart(paymentMethod?.type);
	if (!type) {
		return null;
	}
	return {
		brand: nonEmptyPaymentPart(paymentMethod?.brand),
		last4: nonEmptyPaymentPart(paymentMethod?.last4),
		type,
	};
}

function paymentMethodFromOrderRow(row: {
	stripePaymentMethodBrand: string | null;
	stripePaymentMethodLast4: string | null;
	stripePaymentMethodType: string | null;
}): OrderPaymentMethodSummary | null {
	const type = nonEmptyPaymentPart(row.stripePaymentMethodType);
	if (!type) {
		return null;
	}
	return {
		brand: nonEmptyPaymentPart(row.stripePaymentMethodBrand),
		last4: nonEmptyPaymentPart(row.stripePaymentMethodLast4),
		type,
	};
}

type NormalizedQuoteSnapshot =
	| NormalizedAccommodationQuoteSnapshot
	| NormalizedActivityQuoteSnapshot;

interface RevalidatedSnapshot {
	itemId: string;
	snapshot: NormalizedQuoteSnapshot;
	type: "accommodation" | "activity";
}

interface RevalidatedCartDiscount {
	applied: AppliedDiscountSnapshot | null;
	resolved: AppliedDiscountSnapshot | null;
}

interface SagaBookingBase {
	attemptCount: number;
	charges: ReservationChargeInput[];
	externalAccountId: string;
	imageUrlSnapshot: string | null;
	itemTotalMinor: number;
	normalizedStatus: string;
	orderItemId: string;
	provider: string;
	providerBookingId: string;
	providerReservationId: string | null;
	providerTransactionId: string | null;
	titleSnapshot: string;
}

/** One accommodation provider booking joined with its order item + detail. */
interface AccommodationSagaBooking extends SagaBookingBase {
	checkIn: string;
	checkOut: string;
	guests: number;
	hostifyListingId: string;
	itemType: "accommodation";
	pets: number;
}

/** One activity provider booking joined with its order item + detail. */
interface ActivitySagaBooking extends SagaBookingBase {
	activityAnswers: NormalizedActivityQuoteSnapshot["answers"];
	activityDate: string;
	bokunActivityId: string;
	dropoffPlaceId: string | null;
	itemType: "activity";
	participants: NormalizedActivityQuoteSnapshot["participants"];
	pickupPlaceId: string | null;
	rateId: string | null;
	roomNumber: string | null;
	startTimeId: string | null;
	totalParticipants: number;
}

type SagaBooking = AccommodationSagaBooking | ActivitySagaBooking;

/** Everything the saga needs to drive one order's provider holds. */
interface SagaContext {
	bookings: SagaBooking[];
	contact: {
		billingAddress: OrderBillingAddressSnapshot;
		dateOfBirth: string | null;
		email: string;
		firstName: string | null;
		language: string | null;
		lastName: string | null;
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
		stripePaymentMethodBrand: string | null;
		stripePaymentMethodLast4: string | null;
		stripePaymentMethodType: string | null;
		stripeRefundId: string | null;
		stripeRefundIdempotencyKey: string | null;
	};
}

type HoldItemResult =
	| "held"
	| "transient"
	| "permanent"
	| { unavailable: string }
	| { invalid: string };
type MutateItemResult = "ok" | "transient" | "permanent" | "not_settled";
type PersistHoldPlacedResult = "already_linked" | "conflict" | "persisted";

/** Email side-effects the reconciler delegates back to the app (transport seam). */
interface ReconcileHandlers {
	onCompensated?: (facts: OrderCompensationFacts) => Promise<void>;
	onConfirmed?: (facts: OrderConfirmationFacts) => Promise<void>;
	onPendingNotice?: (facts: OrderConfirmationFacts) => Promise<void>;
}

interface AccommodationCartJoinedRow {
	cartItemId: string;
	itemType: "accommodation";
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

interface ActivityCartJoinedRow {
	activityAnswers: NormalizedActivityQuoteSnapshot["answers"];
	activityDate: string;
	activityId: string;
	activitySummary: unknown | null;
	activityTitle: string | null;
	cartItemId: string;
	city: string | null;
	country: string | null;
	currency: string;
	externalAccountId: string;
	fetchedAt: Date;
	itemType: "activity";
	participants: NormalizedActivityQuoteSnapshot["participants"];
	position: number;
	provider: string;
	providerPayload: Record<string, unknown> | null;
	quoteExpiresAt: Date;
	quoteId: string;
	quoteStatus: string;
	rateId: string | null;
	startTimeId: string | null;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	totalParticipants: number;
	updatedAt: Date;
}

type CartJoinedRow = AccommodationCartJoinedRow | ActivityCartJoinedRow;

interface AccommodationOrderSource {
	cartItemId: string;
	position: number;
	quote: NormalizedAccommodationQuoteSnapshot;
	snapshot: ListingDisplaySnapshot;
	type: "accommodation";
}

interface ActivityOrderSource {
	cartItemId: string;
	position: number;
	quote: NormalizedActivityQuoteSnapshot;
	snapshot: CommerceCatalogSnapshot;
	type: "activity";
}

type OrderSource = AccommodationOrderSource | ActivityOrderSource;

export class CommerceService {
	readonly #accountId: string;
	readonly #activityAccountId: string;
	readonly #currency: string;
	readonly #db: Database;
	readonly #provider: string;
	readonly #quoteAccommodation: CommerceServiceOptions["quoteAccommodation"];
	readonly #quoteActivity: CommerceServiceOptions["quoteActivity"];
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
		this.#activityAccountId = options.activityAccountId ?? options.accountId;
		this.#currency = options.currency;
		this.#db = options.db;
		this.#provider = options.provider;
		this.#quoteAccommodation = options.quoteAccommodation;
		this.#quoteActivity = options.quoteActivity;
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

		const itemTypes = await this.#db
			.select({ type: orderItemTable.type })
			.from(orderItemTable)
			.where(eq(orderItemTable.orderId, row.id));

		return {
			accommodationItemCount: itemTypes.filter(
				(item) => item.type === "accommodation",
			).length,
			activityItemCount: itemTypes.filter((item) => item.type === "activity")
				.length,
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
				dateOfBirth: orderContactTable.dateOfBirth,
				email: orderContactTable.email,
				firstName: orderContactTable.firstName,
				isCompany: orderContactTable.isCompany,
				language: orderContactTable.language,
				lastName: orderContactTable.lastName,
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
			dateOfBirth: row.dateOfBirth,
			email: row.email,
			firstName: row.firstName,
			isCompany: row.isCompany ?? false,
			language: row.language,
			lastName: row.lastName,
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
					dateOfBirth: contact.dateOfBirth,
					email: contact.email,
					firstName: contact.firstName,
					isCompany: contact.isCompany,
					language: contact.language,
					lastName: contact.lastName,
					name: contact.name,
					notes: contact.notes,
					phoneE164: contact.phoneE164,
					taxNumber: contact.taxNumber,
				})
				.where(eq(orderContactTable.orderId, row.id));
		});
	}

	/**
	 * Updates draft activity answers and pickup/dropoff choices in place before
	 * the provider hold is placed. The activity selection and total are unchanged,
	 * so the existing PaymentIntent remains valid.
	 */
	async updateDraftOrderActivityDetails(
		publicReference: string,
		owner: CartOwner,
		activityDetails: DraftOrderActivityDetailInput[],
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

			const activityRows = await tx
				.select({
					orderItemId: orderItemTable.id,
					sourceCartItemId: orderItemTable.sourceCartItemId,
				})
				.from(orderItemTable)
				.innerJoin(
					activityItemDetailTable,
					eq(activityItemDetailTable.orderItemId, orderItemTable.id),
				)
				.where(
					and(
						eq(orderItemTable.orderId, row.id),
						eq(orderItemTable.type, "activity"),
					),
				);
			const orderItemByCartItemId = new Map(
				activityRows.flatMap((activityRow) =>
					activityRow.sourceCartItemId
						? [[activityRow.sourceCartItemId, activityRow.orderItemId] as const]
						: [],
				),
			);
			const seen = new Set<string>();
			const issues = activityDetails.flatMap((detail, index) => {
				const path = `activityDetails.${index}.cartItemId`;
				if (seen.has(detail.cartItemId)) {
					return [{ message: "Duplicate activity item.", path }];
				}
				seen.add(detail.cartItemId);
				if (!orderItemByCartItemId.has(detail.cartItemId)) {
					return [
						{ message: "Activity item does not belong to this order.", path },
					];
				}
				return [];
			});
			if (issues.length > 0) {
				throw invalidRequest(
					"Invalid activity details for this order.",
					issues,
				);
			}

			const now = new Date();
			for (const detail of activityDetails) {
				const orderItemId = orderItemByCartItemId.get(detail.cartItemId);
				if (!orderItemId) {
					continue;
				}
				await tx
					.update(activityItemDetailTable)
					.set({
						answers: detail.answers,
						dropoffPlaceId: detail.dropoffPlaceId,
						pickupPlaceId: detail.pickupPlaceId,
						roomNumber: detail.roomNumber,
					})
					.where(eq(activityItemDetailTable.orderItemId, orderItemId));
				await tx
					.update(orderItemTable)
					.set({ updatedAt: now })
					.where(eq(orderItemTable.id, orderItemId));
			}
			if (activityDetails.length > 0) {
				await tx
					.update(orderTable)
					.set({ updatedAt: now })
					.where(eq(orderTable.id, row.id));
			}
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
			const paymentMethod = normalizePaymentMethodSummary(
				payment.paymentMethod,
			);
			const paymentMethodFields = paymentMethod
				? {
						stripePaymentMethodBrand: paymentMethod.brand,
						stripePaymentMethodLast4: paymentMethod.last4,
						stripePaymentMethodType: paymentMethod.type,
					}
				: {};
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
						...paymentMethodFields,
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
					...paymentMethodFields,
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
				amountRefundedMinor: orderTable.amountRefundedMinor,
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

		const [guestRows, conversationRows] = await Promise.all([
			this.#db
				.select({
					identityStatus: bookingGuestTable.identityStatus,
				})
				.from(bookingGuestTable)
				.innerJoin(
					providerBookingTable,
					eq(providerBookingTable.id, bookingGuestTable.providerBookingId),
				)
				.where(eq(providerBookingTable.orderId, row.id)),
			this.#db
				.select({
					externalThreadId: conversationTable.externalThreadId,
					provider: conversationTable.provider,
					status: conversationTable.status,
				})
				.from(conversationTable)
				.where(eq(conversationTable.orderId, row.id)),
		]);
		const bookingStatus = toOrderBookingStatus(row.status);

		return {
			amountPaidMinor: row.amountPaidMinor,
			bookingStatus,
			conversationAvailability:
				summarizeConversationAvailability(conversationRows),
			currency: row.currency,
			guestProgress: summarizeGuestProgress(
				guestRows.map((guest) => guest.identityStatus),
			),
			orderId: row.id,
			provisioningSubState: toOrderProvisioningSubState({
				amountPaidMinor: row.amountPaidMinor,
				amountRefundedMinor: row.amountRefundedMinor,
				bookingStatus,
			}),
			publicReference: row.publicReference,
			stripePaymentIntentId: row.stripePaymentIntentId,
			totalMinor: row.totalMinor,
		};
	}

	/**
	 * Resolves who is acting on an order and what they may do — the spine every
	 * `/order/[reference]` route authorizes through. A member is authorized by the
	 * hashed booking-access token from their redeemed cookie, while the original
	 * cart-cookie / signed-in-user grants still resolve the
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

			// Capacity is structural now: a per-guest invite already reserves one
			// booking slot at invite time, so acceptance cannot overflow the house and
			// needs no counting. Only gate the invited -> active transition; a re-redeem
			// of an already-active token is idempotent. Still reject a signed-in account
			// that already holds another active membership on this order, so one person
			// never ends up holding two memberships (a member invited to several stays
			// holds one membership with several slots bound to it).
			if (member.status !== "active") {
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
			}

			const resolvedUserId =
				options.userId && !member.userId ? options.userId : member.userId;
			const [updated] = await tx
				.update(orderMemberTable)
				.set({
					acceptedAt: member.acceptedAt ?? now,
					expiresAt: null,
					lastSeenAt: now,
					status: "active",
					userId: resolvedUserId,
				})
				.where(eq(orderMemberTable.id, member.id))
				.returning();

			// Stamp the redeeming account onto the slot this invite reserved, so the
			// account-reuse prefill and audit trail know whose slot it is.
			if (resolvedUserId) {
				await tx
					.update(bookingGuestTable)
					.set({ updatedAt: now, userId: resolvedUserId })
					.where(
						and(
							eq(bookingGuestTable.orderId, order.id),
							eq(bookingGuestTable.orderMemberId, member.id),
							isNull(bookingGuestTable.userId),
						),
					);
			}

			return { member: updated ?? member, order, role: member.role };
		});
	}

	async issueOwnerAccessToken(
		orderId: string,
		email: string,
	): Promise<IssueMemberTokenResult> {
		return this.#persistOwnerAccessToken(orderId, email, generateMemberToken());
	}

	/**
	 * Activates a caller-generated owner token after its email was accepted by the
	 * transport. This keeps confirmation-email retries resend-safe: a failed send
	 * leaves no rotated-but-undelivered owner link in the database.
	 */
	async activateOwnerAccessToken(
		orderId: string,
		email: string,
		token: string,
	): Promise<IssueMemberTokenResult> {
		if (token.trim().length === 0) {
			throw invalidRequest("Owner access token is required.", [
				{ message: "Owner access token is required.", path: "token" },
			]);
		}
		return this.#persistOwnerAccessToken(orderId, email, token);
	}

	/**
	 * Provisions (or rotates) the order's `owner` member and persists the supplied
	 * token hash. Idempotent: the partial-unique owner index caps an order at one
	 * owner, so a re-run rotates the existing row's token rather than inserting a
	 * second. Binds the booker's account when the order has one.
	 */
	async #persistOwnerAccessToken(
		orderId: string,
		email: string,
		token: string,
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

			const now = new Date();
			if (existing) {
				await tx
					.update(orderMemberTable)
					.set({
						accessTokenHash: hashMemberToken(token),
						acceptedAt: existing.acceptedAt ?? now,
						email: email.trim().toLowerCase(),
						expiresAt: null,
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
				email: email.trim().toLowerCase(),
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
	 * and short-lived; capacity is enforced at acceptance, not here. An email the
	 * order already knows joins through its existing membership instead of being
	 * rejected: the extra slot binds to that member (so one person invited to
	 * several stays of a multi-booking order sees them all), a still-pending
	 * member gets a rotated link that covers every bound slot on redemption, and
	 * an active member keeps their live access untouched. The same email can
	 * never hold two slots on one stay.
	 */
	async inviteGuest(
		access: ResolvedOrderAccess,
		input: { bookingGuestId: string; email: string; providerBookingId: string },
		deliver: InviteDelivery,
	): Promise<InviteGuestResult> {
		this.#assertOrderPermission(access, "invite_members");
		const email = input.email.trim().toLowerCase();
		if (!EMAIL_ADDRESS_PATTERN.test(email)) {
			throw invalidRequest("A valid email address is required.", [
				{ message: "Enter a valid email address.", path: "email" },
			]);
		}
		await this.#loadProviderBookingForAccess(access, input.providerBookingId);

		// The invite binds this specific slot, so first read who (if anyone) already
		// holds it, then guard against the same person landing on two slots.
		const slot = await this.#loadBookingGuestForAccess(
			input.providerBookingId,
			input.bookingGuestId,
		);
		const currentMember = slot.orderMemberId
			? await this.#loadOrderMember(access.order.id, slot.orderMemberId)
			: null;
		if (currentMember?.status === "active") {
			throw new CommerceError(
				"order_member_exists",
				"That guest slot is already filled. Remove the current guest first.",
				409,
			);
		}

		const [emailMember] = await this.#db
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
		if (emailMember && emailMember.id !== currentMember?.id) {
			// The same email may join several bookings of a multi-stay order, but
			// never the same booking twice.
			const [slotInBooking] = await this.#db
				.select({ id: bookingGuestTable.id })
				.from(bookingGuestTable)
				.where(
					and(
						eq(bookingGuestTable.providerBookingId, input.providerBookingId),
						eq(bookingGuestTable.orderMemberId, emailMember.id),
					),
				)
				.limit(1);
			if (slotInBooking) {
				throw guestAlreadyInStayError(emailMember.status);
			}
			// Reassigning a slot whose pending invite belongs to someone else onto
			// an existing membership would silently strand that pending member, so
			// make the owner cancel it explicitly first.
			if (currentMember) {
				throw new CommerceError(
					"order_member_exists",
					"That guest slot has a pending invite. Cancel it first.",
					409,
				);
			}

			// Bind the extra slot to the membership the order already has for this
			// email. A still-pending member gets a rotated link (rotate-on-resend:
			// redemption grants every slot bound to them); an active member already
			// holds live access, so their token is left alone and no email is sent.
			const rebindToken =
				emailMember.status === "invited" ? generateMemberToken() : null;
			const rebindExpiresAt = rebindToken ? memberInviteExpiresAt() : null;
			if (rebindToken) {
				// Deliver before persisting, mirroring the fresh-invite path: a mail
				// failure leaves the member's current link working.
				await deliver({ email, token: rebindToken });
			}
			try {
				await this.#db.transaction(async (tx) => {
					const [locked] = await tx
						.select(bookingGuestSelection)
						.from(bookingGuestTable)
						.where(
							and(
								eq(bookingGuestTable.id, input.bookingGuestId),
								eq(
									bookingGuestTable.providerBookingId,
									input.providerBookingId,
								),
							),
						)
						.limit(1)
						.for("update");
					if (!locked) {
						throw new CommerceError(
							"booking_guest_not_found",
							"Guest not found.",
							404,
						);
					}
					if (rebindToken && rebindExpiresAt) {
						await tx
							.update(orderMemberTable)
							.set({
								accessTokenHash: hashMemberToken(rebindToken),
								expiresAt: rebindExpiresAt,
							})
							.where(eq(orderMemberTable.id, emailMember.id));
					}
					await tx
						.update(bookingGuestTable)
						.set({ orderMemberId: emailMember.id, updatedAt: new Date() })
						.where(eq(bookingGuestTable.id, input.bookingGuestId));
				});
			} catch (error) {
				if (isBookingGuestMemberConflict(error)) {
					throw guestAlreadyInStayError(emailMember.status);
				}
				throw error;
			}
			trackEvent({
				metadata: {
					bookingGuestId: input.bookingGuestId,
					memberId: emailMember.id,
					orderId: access.order.id,
				},
				name: "order_member_invited",
				provider: this.#provider,
				type: "integration",
			});
			return {
				email,
				expiresAt: rebindExpiresAt,
				memberId: emailMember.id,
				status: emailMember.status === "active" ? "active" : "invited",
				token: rebindToken,
			};
		}

		// Reuse this slot's still-pending invite row (rotating its token, and its
		// email if the owner reassigned the slot) rather than stacking rows.
		const reuseMemberId =
			currentMember?.status === "invited" ? currentMember.id : null;
		const memberId = reuseMemberId ?? crypto.randomUUID();
		const token = generateMemberToken();
		const expiresAt = memberInviteExpiresAt();

		// Deliver before persisting: a mail-provider failure then leaves no dangling
		// invite and does not rotate a reused row's live token, so the caller gets a
		// clean error and a safe retry.
		await deliver({ email, token });

		await this.#db.transaction(async (tx) => {
			const [locked] = await tx
				.select(bookingGuestSelection)
				.from(bookingGuestTable)
				.where(
					and(
						eq(bookingGuestTable.id, input.bookingGuestId),
						eq(bookingGuestTable.providerBookingId, input.providerBookingId),
					),
				)
				.limit(1)
				.for("update");
			if (!locked) {
				throw new CommerceError(
					"booking_guest_not_found",
					"Guest not found.",
					404,
				);
			}

			if (reuseMemberId) {
				await tx
					.update(orderMemberTable)
					.set({
						acceptedAt: null,
						accessTokenHash: hashMemberToken(token),
						email,
						expiresAt,
						lastSeenAt: null,
						status: "invited",
						userId: null,
					})
					.where(eq(orderMemberTable.id, reuseMemberId));
			} else {
				await tx.insert(orderMemberTable).values({
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
				await tx
					.update(bookingGuestTable)
					.set({ orderMemberId: memberId, updatedAt: new Date() })
					.where(eq(bookingGuestTable.id, input.bookingGuestId));
			}
		});

		trackEvent({
			metadata: {
				bookingGuestId: input.bookingGuestId,
				memberId,
				orderId: access.order.id,
			},
			name: "order_member_invited",
			provider: this.#provider,
			type: "integration",
		});
		return { email, expiresAt, memberId, status: "invited", token };
	}

	/**
	 * Revokes a member's access (owner only) and frees the guest slot they held so
	 * the owner can fill it or re-invite. The owner cannot be revoked. Idempotent:
	 * re-revoking an already-revoked member is a no-op.
	 *
	 * Slot cleanup depends on how far the member got: an `active` member may have
	 * entered or verified their own identity, so their slot is wiped back to empty
	 * (their PII must not linger on a slot the owner reclaims). A still-`invited`
	 * member never touched the slot, so cancelling only unbinds it, preserving any
	 * details the owner had pre-filled before inviting.
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

		const wipeSlotData = member.status === "active";
		const now = new Date();
		await this.#db.transaction(async (tx) => {
			await tx
				.update(orderMemberTable)
				.set({ status: "revoked" })
				.where(eq(orderMemberTable.id, member.id));

			const slotReset: Partial<typeof bookingGuestTable.$inferInsert> =
				wipeSlotData
					? {
							dateOfBirthEncrypted: null,
							documentExpiresOnEncrypted: null,
							documentIssuingCountryEncrypted: null,
							documentNumberEncrypted: null,
							documentTypeEncrypted: null,
							firstNameEncrypted: null,
							identityStatus: "missing",
							lastNameEncrypted: null,
							nationalityEncrypted: null,
							orderMemberId: null,
							purgeAfter: null,
							residenceCountryEncrypted: null,
							stripeVerificationReportId: null,
							stripeVerificationSessionId: null,
							submittedAt: null,
							updatedAt: now,
							userId: null,
							userIdentityDocumentId: null,
						}
					: { orderMemberId: null, updatedAt: now };

			await tx
				.update(bookingGuestTable)
				.set(slotReset)
				.where(
					and(
						eq(bookingGuestTable.orderId, access.order.id),
						eq(bookingGuestTable.orderMemberId, member.id),
					),
				);
		});

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

	async readBookingGuests(
		access: ResolvedOrderAccess,
		providerBookingId: string,
	): Promise<BookingGuestList> {
		await this.#loadProviderBookingForAccess(access, providerBookingId);
		const rows = await this.#readBookingGuestRowsWithMember(
			this.#db,
			providerBookingId,
		);

		if (access.role === "owner") {
			this.#assertOrderPermission(access, "manage_all_guests");
			return {
				bookingId: providerBookingId,
				guests: rows.map((row) =>
					bookingGuestDto(
						row,
						toGuestAssignment(
							row.orderMemberId && row.memberEmail
								? {
										email: row.memberEmail,
										expiresAt: row.memberExpiresAt,
										id: row.orderMemberId,
										status: row.memberStatus ?? "invited",
									}
								: null,
						),
					),
				),
			};
		}

		this.#assertOrderPermission(access, "manage_own_guest");
		const member = access.member;
		if (!member) {
			throw new CommerceError(
				"order_access_denied",
				"You do not have access to do that.",
				403,
			);
		}

		// Per-guest invites bind the slot at invite time, so a member only ever sees
		// the slot they were invited to fill; there is no lazy claim of a free slot.
		const owned = rows.find((row) => row.orderMemberId === member.id);
		if (!owned) {
			throw new CommerceError(
				"order_full",
				"No guest slot is available for this booking.",
				409,
			);
		}

		return {
			bookingId: providerBookingId,
			guests: [
				bookingGuestDto(owned, {
					email: member.email,
					expiresAt: null,
					kind: "member",
					memberId: member.id,
					status: "active",
				}),
			],
		};
	}

	async updateBookingGuests(
		access: ResolvedOrderAccess,
		providerBookingId: string,
		inputs: BookingGuestUpdateInput[],
	): Promise<BookingGuestList> {
		if (inputs.length === 0) {
			throw invalidRequest("At least one guest is required.", [
				{ message: "At least one guest is required.", path: "guests" },
			]);
		}

		await this.#loadProviderBookingForAccess(access, providerBookingId);
		const now = new Date();

		if (access.role === "owner") {
			this.#assertOrderPermission(access, "manage_all_guests");
			await this.#db.transaction(async (tx) => {
				const booking = await this.#loadProviderBookingForAccess(
					access,
					providerBookingId,
					tx,
				);
				for (const [index, input] of inputs.entries()) {
					if (!input.id) {
						throw invalidRequest("Guest id is required.", [
							{
								message: "Guest id is required.",
								path: `guests.${index}.id`,
							},
						]);
					}
					await this.#updateGuestIdentityFields(tx, {
						guestId: input.id,
						fields: input.fields,
						now,
						orderMemberId: undefined,
						providerBookingId,
						purgeAfter: bookingGuestPurgeAfter(booking.stayEndsAt, now),
					});
				}
			});
		} else {
			this.#assertOrderPermission(access, "manage_own_guest");
			const member = access.member;
			if (!member) {
				throw new CommerceError(
					"order_access_denied",
					"You do not have access to do that.",
					403,
				);
			}
			if (inputs.length !== 1) {
				throw invalidRequest("Members can update one guest slot.", [
					{
						message: "Members can update one guest slot.",
						path: "guests",
					},
				]);
			}
			const input = inputs[0];
			if (!input) {
				throw invalidRequest("A guest is required.", [
					{ message: "A guest is required.", path: "guests" },
				]);
			}
			await this.#db.transaction(async (tx) => {
				const booking = await this.#loadProviderBookingForAccess(
					access,
					providerBookingId,
					tx,
				);
				const target = await this.#loadMemberBoundGuest(tx, {
					memberId: member.id,
					providerBookingId,
					requestedGuestId: input.id ?? null,
				});
				await this.#updateGuestIdentityFields(tx, {
					guestId: target.id,
					fields: input.fields,
					now,
					orderMemberId: member.id,
					providerBookingId,
					purgeAfter: bookingGuestPurgeAfter(booking.stayEndsAt, now),
				});
			});
		}

		trackEvent({
			metadata: { orderId: access.order.id, providerBookingId },
			name: "guest_identity_provided",
			provider: this.#provider,
			type: "integration",
		});

		return this.readBookingGuests(access, providerBookingId);
	}

	/**
	 * Copies a signed-in caller's already-verified account identity into a guest
	 * slot, skipping a fresh Stripe scan. The encrypted columns are an independent
	 * legal snapshot (values are copied, not referenced); `userIdentityDocumentId`
	 * records provenance. The owner may apply it to any slot they manage; a member
	 * only to the slot they were invited to fill.
	 */
	async applyVerifiedAccountIdentityToGuest(
		access: ResolvedOrderAccess,
		providerBookingId: string,
		guestId: string,
		prefill: GuestIdentityPrefill,
	): Promise<BookingGuestList> {
		const booking = await this.#loadProviderBookingForAccess(
			access,
			providerBookingId,
		);
		const now = new Date();
		const fields: BookingGuestIdentityFields = {
			dateOfBirth: prefill.fields.dateOfBirth,
			documentExpiresOn: prefill.fields.documentExpiresOn,
			documentIssuingCountry: prefill.fields.documentIssuingCountry,
			documentNumber: prefill.fields.documentNumber,
			documentType: prefill.fields.documentType,
			firstName: prefill.fields.firstName,
			lastName: prefill.fields.lastName,
			nationality: prefill.fields.nationality,
			residenceCountry: prefill.residenceCountry,
		};

		if (access.role === "owner") {
			this.#assertOrderPermission(access, "manage_all_guests");
		} else {
			this.#assertOrderPermission(access, "manage_own_guest");
			if (!access.member) {
				throw new CommerceError(
					"order_access_denied",
					"You do not have access to do that.",
					403,
				);
			}
		}

		await this.#db.transaction(async (tx) => {
			const member = access.member;
			const target =
				access.role === "owner" || !member
					? await this.#lockBookingGuest(tx, providerBookingId, guestId)
					: await this.#loadMemberBoundGuest(tx, {
							memberId: member.id,
							providerBookingId,
							requestedGuestId: guestId,
						});

			await tx
				.update(bookingGuestTable)
				.set({
					...encryptGuestFields(fields),
					identityStatus: "verified",
					purgeAfter: bookingGuestPurgeAfter(booking.stayEndsAt, now),
					stripeVerificationReportId: prefill.fields.stripeVerificationReportId,
					stripeVerificationSessionId: null,
					submittedAt: now,
					updatedAt: now,
					userIdentityDocumentId: prefill.userIdentityDocumentId,
				})
				.where(eq(bookingGuestTable.id, target.id));
		});

		trackEvent({
			metadata: { orderId: access.order.id, providerBookingId },
			name: "guest_identity_verified",
			provider: this.#provider,
			type: "integration",
		});

		return this.readBookingGuests(access, providerBookingId);
	}

	/**
	 * Writes only the two residency fields Stripe Identity never returns
	 * (nationality, country of residence) without disturbing verification state.
	 * This backs the "confirm residency" step after a verified scan or account
	 * reuse, so completing those fields does not downgrade a verified slot the way
	 * a full manual save (which resets to `provided`) would.
	 */
	async patchGuestResidency(
		access: ResolvedOrderAccess,
		providerBookingId: string,
		guestId: string,
		input: { nationality: string; residenceCountry: string },
	): Promise<BookingGuestList> {
		await this.#loadProviderBookingForAccess(access, providerBookingId);
		const nationality = input.nationality.trim().toUpperCase();
		const residenceCountry = input.residenceCountry.trim().toUpperCase();
		const isCountry = (value: string) => /^[A-Z]{2}$/.test(value);
		if (!isCountry(nationality) || !isCountry(residenceCountry)) {
			throw invalidRequest("A valid two-letter country code is required.", [
				...(isCountry(nationality)
					? []
					: [{ message: "Enter a 2-letter code.", path: "nationality" }]),
				...(isCountry(residenceCountry)
					? []
					: [{ message: "Enter a 2-letter code.", path: "residenceCountry" }]),
			]);
		}

		const now = new Date();
		if (access.role === "owner") {
			this.#assertOrderPermission(access, "manage_all_guests");
		} else {
			this.#assertOrderPermission(access, "manage_own_guest");
			if (!access.member) {
				throw new CommerceError(
					"order_access_denied",
					"You do not have access to do that.",
					403,
				);
			}
		}

		await this.#db.transaction(async (tx) => {
			const member = access.member;
			const target =
				access.role === "owner" || !member
					? await this.#lockBookingGuest(tx, providerBookingId, guestId)
					: await this.#loadMemberBoundGuest(tx, {
							memberId: member.id,
							providerBookingId,
							requestedGuestId: guestId,
						});
			await tx
				.update(bookingGuestTable)
				.set({
					nationalityEncrypted: encryptGuestField(nationality),
					residenceCountryEncrypted: encryptGuestField(residenceCountry),
					updatedAt: now,
				})
				.where(eq(bookingGuestTable.id, target.id));
		});

		return this.readBookingGuests(access, providerBookingId);
	}

	async prepareBookingGuestIdentitySession(
		access: ResolvedOrderAccess,
		providerBookingId: string,
		guestId: string,
	): Promise<BookingGuestIdentitySessionTarget> {
		await this.#loadProviderBookingForAccess(access, providerBookingId);

		if (access.role === "owner") {
			this.#assertOrderPermission(access, "manage_all_guests");
			await this.#loadBookingGuestForAccess(providerBookingId, guestId);
			return {
				bookingGuestId: guestId,
				orderId: access.order.id,
				providerBookingId,
			};
		}

		this.#assertOrderPermission(access, "manage_own_guest");
		const member = access.member;
		if (!member) {
			throw new CommerceError(
				"order_access_denied",
				"You do not have access to do that.",
				403,
			);
		}

		await this.#db.transaction(async (tx) => {
			await this.#loadMemberBoundGuest(tx, {
				memberId: member.id,
				providerBookingId,
				requestedGuestId: guestId,
			});
		});

		return {
			bookingGuestId: guestId,
			orderId: access.order.id,
			providerBookingId,
		};
	}

	async linkBookingGuestIdentitySession(
		guestId: string,
		sessionId: string,
		status: Exclude<IdentityVerificationStatus, "unstarted">,
	): Promise<void> {
		const now = new Date();
		const [updated] = await this.#db
			.update(bookingGuestTable)
			.set({
				identityStatus: identityStatusToBookingGuestStatus(status),
				stripeVerificationSessionId: sessionId,
				updatedAt: now,
			})
			.where(eq(bookingGuestTable.id, guestId))
			.returning({ id: bookingGuestTable.id });
		if (!updated) {
			throw new CommerceError(
				"booking_guest_not_found",
				"Guest not found.",
				404,
			);
		}
	}

	async applyBookingGuestIdentityStatus({
		bookingGuestId,
		sessionId,
		status,
		statusChangedAt,
		verifiedFields,
	}: {
		bookingGuestId?: string | null;
		sessionId: string;
		status: Exclude<IdentityVerificationStatus, "unstarted">;
		statusChangedAt: string | null;
		verifiedFields?: VerifiedIdentityDocumentFields;
	}): Promise<string | null> {
		const findTarget = (where: SQL) =>
			this.#db
				.select({
					...bookingGuestSelection,
					stayEndsAt: providerBookingTable.stayEndsAt,
				})
				.from(bookingGuestTable)
				.innerJoin(
					providerBookingTable,
					eq(providerBookingTable.id, bookingGuestTable.providerBookingId),
				)
				.where(where)
				.limit(1);

		const [linkedTarget] = await findTarget(
			eq(bookingGuestTable.stripeVerificationSessionId, sessionId),
		);
		const [fallbackTarget] =
			!linkedTarget && bookingGuestId
				? await findTarget(eq(bookingGuestTable.id, bookingGuestId))
				: [];
		const existing = linkedTarget ?? fallbackTarget;

		if (!existing) {
			return null;
		}

		const nextStatus = identityStatusToBookingGuestStatus(status);
		if (existing.identityStatus === "verified" && nextStatus !== "verified") {
			return existing.id;
		}

		const now = new Date();
		const statusAt = parseWebhookTimestamp(statusChangedAt) ?? now;
		const set: Partial<typeof bookingGuestTable.$inferInsert> = {
			identityStatus: nextStatus,
			purgeAfter:
				existing.purgeAfter ?? bookingGuestPurgeAfter(existing.stayEndsAt, now),
			stripeVerificationSessionId:
				existing.stripeVerificationSessionId ?? sessionId,
			updatedAt: now,
		};

		if (
			(nextStatus === "processing" || nextStatus === "verified") &&
			!existing.submittedAt
		) {
			set.submittedAt = statusAt;
		}

		if (nextStatus === "verified") {
			if (!verifiedFields) {
				throw new Error("verified guest identity fields are required");
			}
			Object.assign(set, {
				dateOfBirthEncrypted: encryptVerifiedGuestField(
					verifiedFields.dateOfBirth,
					existing.dateOfBirthEncrypted,
				),
				documentExpiresOnEncrypted: encryptVerifiedGuestField(
					verifiedFields.documentExpiresOn,
					existing.documentExpiresOnEncrypted,
				),
				documentIssuingCountryEncrypted: encryptVerifiedGuestField(
					verifiedFields.documentIssuingCountry,
					existing.documentIssuingCountryEncrypted,
				),
				documentNumberEncrypted: encryptVerifiedGuestField(
					verifiedFields.documentNumber,
					existing.documentNumberEncrypted,
				),
				documentTypeEncrypted: encryptVerifiedGuestField(
					verifiedFields.documentType,
					existing.documentTypeEncrypted,
				),
				firstNameEncrypted: encryptVerifiedGuestField(
					verifiedFields.firstName,
					existing.firstNameEncrypted,
				),
				lastNameEncrypted: encryptVerifiedGuestField(
					verifiedFields.lastName,
					existing.lastNameEncrypted,
				),
				nationalityEncrypted: encryptVerifiedGuestField(
					verifiedFields.nationality,
					existing.nationalityEncrypted,
				),
				stripeVerificationReportId: verifiedFields.stripeVerificationReportId,
			});
		}

		await this.#db
			.update(bookingGuestTable)
			.set(set)
			.where(eq(bookingGuestTable.id, existing.id));

		if (nextStatus === "verified") {
			trackEvent({
				metadata: {
					bookingGuestId: existing.id,
					providerBookingId: existing.providerBookingId,
				},
				name: "guest_identity_verified",
				provider: this.#provider,
				type: "integration",
			});
		}

		return existing.id;
	}

	async #loadProviderBookingForAccess(
		access: ResolvedOrderAccess,
		providerBookingId: string,
		db: DbExecutor = this.#db,
	): Promise<{ id: string; stayEndsAt: Date | null }> {
		const [booking] = await db
			.select({
				id: providerBookingTable.id,
				stayEndsAt: providerBookingTable.stayEndsAt,
			})
			.from(providerBookingTable)
			.where(
				and(
					eq(providerBookingTable.id, providerBookingId),
					eq(providerBookingTable.orderId, access.order.id),
				),
			)
			.limit(1);
		if (!booking) {
			throw new CommerceError(
				"booking_guest_not_found",
				"Booking not found.",
				404,
			);
		}
		return booking;
	}

	/**
	 * Guest rows joined to their bound member (if any), so the owner view can label
	 * each slot as unassigned, invited, or filled by a specific person. The join is
	 * left so unassigned slots (the common case) still come back.
	 */
	async #readBookingGuestRowsWithMember(
		db: DbExecutor,
		providerBookingId: string,
	) {
		return db
			.select({
				...bookingGuestSelection,
				memberEmail: orderMemberTable.email,
				memberExpiresAt: orderMemberTable.expiresAt,
				memberStatus: orderMemberTable.status,
			})
			.from(bookingGuestTable)
			.leftJoin(
				orderMemberTable,
				eq(orderMemberTable.id, bookingGuestTable.orderMemberId),
			)
			.where(eq(bookingGuestTable.providerBookingId, providerBookingId))
			.orderBy(asc(bookingGuestTable.position));
	}

	async #loadBookingGuestForAccess(providerBookingId: string, guestId: string) {
		const [guest] = await this.#db
			.select(bookingGuestSelection)
			.from(bookingGuestTable)
			.where(
				and(
					eq(bookingGuestTable.id, guestId),
					eq(bookingGuestTable.providerBookingId, providerBookingId),
				),
			)
			.limit(1);
		if (!guest) {
			throw new CommerceError(
				"booking_guest_not_found",
				"Guest not found.",
				404,
			);
		}
		return guest;
	}

	/** Loads and locks a single guest slot by id within a booking (owner writes). */
	async #lockBookingGuest(
		tx: Transaction,
		providerBookingId: string,
		guestId: string,
	) {
		const [guest] = await tx
			.select(bookingGuestSelection)
			.from(bookingGuestTable)
			.where(
				and(
					eq(bookingGuestTable.id, guestId),
					eq(bookingGuestTable.providerBookingId, providerBookingId),
				),
			)
			.limit(1)
			.for("update");
		if (!guest) {
			throw new CommerceError(
				"booking_guest_not_found",
				"Guest not found.",
				404,
			);
		}
		return guest;
	}

	/**
	 * Loads the single slot a member was invited to fill, locking it for the
	 * enclosing write. Binding happens at invite time, so a member without a bound
	 * slot has no business editing one (409); a request that names a different slot
	 * is rejected (403). Replaces the earlier lazy first-free-slot claim.
	 */
	async #loadMemberBoundGuest(
		tx: Transaction,
		input: {
			memberId: string;
			providerBookingId: string;
			requestedGuestId: string | null;
		},
	) {
		const rows = await tx
			.select(bookingGuestSelection)
			.from(bookingGuestTable)
			.where(eq(bookingGuestTable.providerBookingId, input.providerBookingId))
			.orderBy(asc(bookingGuestTable.position))
			.for("update");
		const owned = rows.find((row) => row.orderMemberId === input.memberId);
		if (!owned) {
			throw new CommerceError(
				"order_full",
				"No guest slot is available for this booking.",
				409,
			);
		}
		if (input.requestedGuestId && input.requestedGuestId !== owned.id) {
			throw new CommerceError(
				"order_access_denied",
				"You can only update your own guest details.",
				403,
			);
		}
		return owned;
	}

	async #updateGuestIdentityFields(
		tx: Transaction,
		input: {
			fields: BookingGuestIdentityFields;
			guestId: string;
			now: Date;
			orderMemberId: string | undefined;
			providerBookingId: string;
			purgeAfter: Date;
		},
	) {
		const [existing] = await tx
			.select(bookingGuestSelection)
			.from(bookingGuestTable)
			.where(
				and(
					eq(bookingGuestTable.id, input.guestId),
					eq(bookingGuestTable.providerBookingId, input.providerBookingId),
				),
			)
			.limit(1)
			.for("update");
		if (!existing) {
			throw new CommerceError(
				"booking_guest_not_found",
				"Guest not found.",
				404,
			);
		}
		if (
			input.orderMemberId !== undefined &&
			existing.orderMemberId !== null &&
			existing.orderMemberId !== input.orderMemberId
		) {
			throw new CommerceError(
				"order_access_denied",
				"You can only update your own guest details.",
				403,
			);
		}

		await tx
			.update(bookingGuestTable)
			.set({
				...encryptGuestFields(input.fields),
				identityStatus: "provided",
				orderMemberId: input.orderMemberId ?? existing.orderMemberId,
				purgeAfter: input.purgeAfter,
				stripeVerificationReportId: null,
				stripeVerificationSessionId: null,
				submittedAt: input.now,
				updatedAt: input.now,
			})
			.where(eq(bookingGuestTable.id, input.guestId));
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
				desc(conversationMessageTable.sentAt),
				desc(conversationMessageTable.id),
			)
			.limit(limit);
		return rows.reverse().map((row) => this.#toMessageDto(row));
	}

	async sendConversationMessage(
		access: ResolvedOrderAccess,
		conversationId: string,
		input: { body: string },
		options: { excludeSocketId?: string | null } = {},
	): Promise<ConversationMessageDto> {
		this.#assertOrderPermission(access, "chat");
		const excludeSocketId = options.excludeSocketId ?? null;
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
		const isInternal = conversation.provider === INTERNAL_CONVERSATION_PROVIDER;
		const externalThreadId = conversation.externalThreadId;
		if (
			conversation.status === "archived" ||
			(!isInternal && externalThreadId === null)
		) {
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
				orderId: access.order.id,
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
			excludeSocketId,
		);

		if (isInternal || externalThreadId === null) {
			// Internal conversation: no provider hop, the stored message is the
			// delivered message.
			const delivered = await this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				pending.id,
				null,
				now,
				excludeSocketId,
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
		}

		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				pending.id,
				"Conversation gateway is not configured.",
				excludeSocketId,
			);
		}

		try {
			const externalMessageId = await gateway.sendMessage(
				externalThreadId,
				body,
				pending.id,
			);
			const delivered = await this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				pending.id,
				externalMessageId,
				now,
				excludeSocketId,
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
				excludeSocketId,
			);
		}
	}

	async sendHostConversationMessage(
		access: ResolvedOrderAccess,
		conversationId: string,
		input: { body: string },
		options: { excludeSocketId?: string | null } = {},
	): Promise<ConversationMessageDto> {
		this.#assertOrderPermission(access, "chat");
		const excludeSocketId = options.excludeSocketId ?? null;
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
		const isInternal = conversation.provider === INTERNAL_CONVERSATION_PROVIDER;
		const externalThreadId = conversation.externalThreadId;
		if (
			conversation.status === "archived" ||
			(!isInternal && externalThreadId === null)
		) {
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
				orderId: access.order.id,
				senderMemberId: null,
				senderType: "host",
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
			excludeSocketId,
		);

		if (isInternal || externalThreadId === null) {
			// Internal conversation: no provider hop, the stored message is the
			// delivered message.
			const delivered = await this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				pending.id,
				null,
				now,
				excludeSocketId,
			);
			trackEvent({
				metadata: {
					conversationId,
					messageId: delivered.id,
					orderId: access.order.id,
				},
				name: "conversation_host_message_sent",
				provider: conversation.provider,
				type: "integration",
			});
			return delivered;
		}

		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				pending.id,
				"Conversation gateway is not configured.",
				excludeSocketId,
			);
		}

		try {
			const externalMessageId = await gateway.sendHostReply(
				externalThreadId,
				body,
			);
			const delivered = await this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				pending.id,
				externalMessageId,
				now,
				excludeSocketId,
			);
			trackEvent({
				metadata: {
					conversationId,
					messageId: delivered.id,
					orderId: access.order.id,
				},
				name: "conversation_host_message_sent",
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
				name: "conversation_host_message_send_failed",
				provider: conversation.provider,
				severity: "warning",
				type: "integration",
			});
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				pending.id,
				message,
				excludeSocketId,
			);
		}
	}

	async retryConversationMessage(
		access: ResolvedOrderAccess,
		conversationId: string,
		messageId: string,
		options: { excludeSocketId?: string | null } = {},
	): Promise<ConversationMessageDto> {
		this.#assertOrderPermission(access, "chat");
		const excludeSocketId = options.excludeSocketId ?? null;
		const conversation = await this.#loadConversationForAccess(
			access,
			conversationId,
		);
		const isInternal = conversation.provider === INTERNAL_CONVERSATION_PROVIDER;
		const externalThreadId = conversation.externalThreadId;
		if (
			conversation.status === "archived" ||
			(!isInternal && externalThreadId === null)
		) {
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
			.where(
				and(
					eq(conversationMessageTable.id, messageId),
					eq(conversationMessageTable.conversationId, conversationId),
					eq(conversationMessageTable.deliveryStatus, "failed"),
				),
			)
			.returning(conversationMessageSelection);
		if (!pending) {
			throw new CommerceError(
				"conversation_message_not_found",
				"Message not found.",
				404,
			);
		}
		await this.#publishMessageCreatedSafe(
			access.order.id,
			conversationId,
			this.#toMessageDto(pending),
			excludeSocketId,
		);

		if (isInternal || externalThreadId === null) {
			return this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				messageId,
				null,
				new Date(),
				excludeSocketId,
			);
		}

		const gateway = this.#conversationGatewayFor(conversation.provider);
		if (!gateway) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				messageId,
				"Conversation gateway is not configured.",
				excludeSocketId,
			);
		}

		try {
			const externalMessageId = await gateway.sendMessage(
				externalThreadId,
				pending.body,
				messageId,
			);
			return this.#markConversationMessageDelivered(
				access.order.id,
				conversationId,
				messageId,
				externalMessageId,
				new Date(),
				excludeSocketId,
			);
		} catch (error) {
			return this.#markConversationMessageFailed(
				access.order.id,
				conversationId,
				messageId,
				error instanceof Error ? error.message : String(error),
				excludeSocketId,
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
			// Providers without an inbox gateway (e.g. Bokun) never get a
			// per-booking conversation; their orders chat through the order-level
			// internal conversation provisioned below.
			if (!this.#conversationGatewayFor(row.provider)) {
				continue;
			}
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

		await this.#archiveStaleBokunConversations(now);

		const internalCandidates = await this.#db
			.select({ orderId: orderTable.id })
			.from(orderTable)
			.leftJoin(
				conversationTable,
				and(
					eq(conversationTable.orderId, orderTable.id),
					inArray(conversationTable.status, ["pending", "active"]),
				),
			)
			.where(
				and(eq(orderTable.status, "confirmed"), isNull(conversationTable.id)),
			)
			.limit(limit);

		for (const candidate of internalCandidates) {
			summary.scanned += 1;
			try {
				const created = await this.#provisionInternalConversation(
					candidate.orderId,
					now,
				);
				if (created) {
					summary.provisioned += 1;
				}
			} catch (error) {
				summary.failed += 1;
				this.#trackConversationReconciliationFailure(
					INTERNAL_CONVERSATION_PROVIDER,
					candidate.orderId,
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
			// Internal conversations have no external thread to link or sync.
			if (conversation.provider === INTERNAL_CONVERSATION_PROVIDER) {
				continue;
			}
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
	 * counts) and only for the stays whose guest slots are bound to their
	 * membership — never the other bookings of a multi-stay order. Authorization
	 * is the caller's responsibility — pass the result of
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
				stripePaymentMethodBrand: orderTable.stripePaymentMethodBrand,
				stripePaymentMethodLast4: orderTable.stripePaymentMethodLast4,
				stripePaymentMethodType: orderTable.stripePaymentMethodType,
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
				activityBokunActivityId: activityItemDetailTable.bokunActivityId,
				activityDate: activityItemDetailTable.activityDate,
				activityDropoffPlaceId: activityItemDetailTable.dropoffPlaceId,
				activityExternalAccountId: activityItemDetailTable.externalAccountId,
				activityPickupPlaceId: activityItemDetailTable.pickupPlaceId,
				activityProvider: activityItemDetailTable.provider,
				activityRateId: activityItemDetailTable.rateId,
				activityRoomNumber: activityItemDetailTable.roomNumber,
				activityStartTimeId: activityItemDetailTable.startTimeId,
				activityTotalParticipants: activityItemDetailTable.totalParticipants,
				adults: accommodationItemDetailTable.adults,
				bookingId: providerBookingTable.id,
				bookingTransactionId: providerBookingTable.providerTransactionId,
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
				listingExternalId: accommodationItemDetailTable.hostifyListingId,
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
				activityItemDetailTable,
				eq(activityItemDetailTable.orderItemId, orderItemTable.id),
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
						orderMemberId: bookingGuestTable.orderMemberId,
						providerBookingId: bookingGuestTable.providerBookingId,
					})
					.from(bookingGuestTable)
					.where(inArray(bookingGuestTable.providerBookingId, bookingIds))
			: [];

		// Progress counts follow the viewer's guest-management scope: the owner
		// counts every slot, an invited member only the slots bound to them, so the
		// hub never advertises totals the guests section will not show.
		const visibleGuestRows = scopeGuestRowsToViewer(
			guestRows,
			access.role,
			access.member?.id ?? null,
		);

		// An invited member's hub only shows the stays they were invited to: the
		// bookings holding a slot bound to their membership (several when the same
		// email was invited to more than one booking in the order).
		const visibleItemRows = scopeOrderItemsToViewer(
			itemRows,
			access.role,
			new Set(visibleGuestRows.map((guest) => guest.providerBookingId)),
		);

		const statusesByBooking = new Map<
			string,
			(typeof guestRows)[number]["identityStatus"][]
		>();
		for (const guest of visibleGuestRows) {
			const bucket = statusesByBooking.get(guest.providerBookingId) ?? [];
			bucket.push(guest.identityStatus);
			statusesByBooking.set(guest.providerBookingId, bucket);
		}

		const chargesByItem = new Map<string, OrderDetailCharge[]>();
		if (isOwner && visibleItemRows.length > 0) {
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
						visibleItemRows.map((row) => row.id),
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

		const items: OrderDetailItem[] = visibleItemRows.map((row) => ({
			activity:
				isOwner &&
				row.type === "activity" &&
				row.activityBokunActivityId &&
				row.activityExternalAccountId &&
				row.activityProvider
					? {
							bokunActivityId: row.activityBokunActivityId,
							dropoffPlaceId: row.activityDropoffPlaceId,
							externalAccountId: row.activityExternalAccountId,
							pickupPlaceId: row.activityPickupPlaceId,
							productConfirmationCode: row.bookingTransactionId,
							provider: row.activityProvider,
							rateId: row.activityRateId,
							roomNumber: row.activityRoomNumber,
							startTimeId: row.activityStartTimeId,
						}
					: null,
			activityDate: row.activityDate,
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
			listingExternalId: row.listingExternalId,
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
							id: row.bookingId,
							needsRecovery: row.bookingNeedsRecovery ?? false,
							status: row.bookingStatus,
						}
					: null,
			title: row.title,
			totalParticipants: row.activityTotalParticipants,
			type: row.type,
		}));

		const orderGuestProgress = summarizeGuestProgress(
			visibleGuestRows.map((guest) => guest.identityStatus),
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

		const bookingStatus = toOrderBookingStatus(orderRow.status);
		const conversations = orderRoleCan(access.role, "chat")
			? await this.readOrderConversations(access)
			: [];

		return {
			bookingStatus,
			contact,
			conversationAvailability:
				summarizeConversationAvailability(conversations),
			createdAt: orderRow.createdAt.toISOString(),
			conversations,
			currency: orderRow.currency,
			guestProgress: orderGuestProgress,
			items,
			members,
			paymentMethod: isOwner ? paymentMethodFromOrderRow(orderRow) : null,
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
			provisioningSubState: toOrderProvisioningSubState({
				amountPaidMinor: orderRow.amountPaidMinor,
				amountRefundedMinor: orderRow.amountRefundedMinor,
				bookingStatus,
			}),
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
		provider: string;
		providerBookingId: string | null;
		status: ConversationSummary["status"];
		unreadCount: number;
	}): ConversationSummary {
		return {
			externalThreadId: row.externalThreadId,
			id: row.id,
			lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
			lastMessagePreview: row.lastMessagePreview,
			provider: row.provider,
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
		excludeSocketId: string | null = null,
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
		await this.#publishMessageCreatedSafe(
			orderId,
			conversationId,
			dto,
			excludeSocketId,
		);
		return dto;
	}

	async #markConversationMessageFailed(
		orderId: string,
		conversationId: string,
		messageId: string,
		errorMessage: string,
		excludeSocketId: string | null = null,
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
		await this.#publishMessageCreatedSafe(
			orderId,
			conversationId,
			dto,
			excludeSocketId,
		);
		return dto;
	}

	async #publishMessageCreatedSafe(
		orderId: string,
		conversationId: string,
		message: ConversationMessageDto,
		excludeSocketId: string | null = null,
	): Promise<void> {
		try {
			await this.#realtimePublisher.publishMessageCreated(
				orderId,
				conversationId,
				message,
				{ excludeSocketId },
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

	/**
	 * Archives leftover per-booking Bokun conversations from before the
	 * order-level internal chat existed. Bokun has no inbox, so these rows could
	 * never link a thread; archiving them lets the internal provisioning pass
	 * pick their orders up. Bounded to the explicit provider so a transiently
	 * missing gateway can never archive a linkable conversation.
	 */
	async #archiveStaleBokunConversations(now: Date): Promise<void> {
		await this.#db
			.update(conversationTable)
			.set({ status: "archived", updatedAt: now })
			.where(
				and(
					eq(conversationTable.provider, "bokun"),
					eq(conversationTable.status, "pending"),
					isNull(conversationTable.externalThreadId),
				),
			);
	}

	/**
	 * Creates the order-level internal conversation for a confirmed order whose
	 * bookings have no provider inbox (e.g. activity-only orders). Orders with a
	 * gateway-capable booking keep chatting through the provider thread instead,
	 * so guests never face two chats for one order.
	 */
	async #provisionInternalConversation(
		orderId: string,
		now: Date,
	): Promise<boolean> {
		const providerRows = await this.#db
			.selectDistinct({ provider: providerBookingTable.provider })
			.from(providerBookingTable)
			.where(eq(providerBookingTable.orderId, orderId));
		if (
			providerRows.some((row) =>
				Boolean(this.#conversationGatewayFor(row.provider)),
			)
		) {
			return false;
		}

		const [created] = await this.#db
			.insert(conversationTable)
			.values({
				createdAt: now,
				externalThreadId: null,
				id: crypto.randomUUID(),
				lastMessagePreview: null,
				orderId,
				provider: INTERNAL_CONVERSATION_PROVIDER,
				providerBookingId: null,
				status: "active",
				unreadCount: 0,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: conversationTable.id });

		if (created) {
			trackEvent({
				metadata: { conversationId: created.id, orderId },
				name: "conversation_provisioned_internal",
				provider: INTERNAL_CONVERSATION_PROVIDER,
				type: "integration",
			});
		}
		return Boolean(created);
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
			const result = await this.#upsertProviderMessage(
				orderId,
				conversationId,
				message,
			);
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
		orderId: string,
		conversationId: string,
		message: ProviderConversationMessage,
	): Promise<{ inserted: boolean; message: ConversationMessageDto }> {
		const now = new Date();
		const [row] = await this.#db
			.insert(conversationMessageTable)
			.values({
				body: message.body,
				conversationId,
				createdAt: now,
				deliveryStatus: "sent",
				externalMessageId: message.externalMessageId,
				id: crypto.randomUUID(),
				isAutomatic: message.isAutomatic,
				orderId,
				rawPayload: message.raw,
				senderType: message.senderType,
				sentAt: message.sentAt,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					conversationMessageTable.conversationId,
					conversationMessageTable.externalMessageId,
				],
				targetWhere: sql`${conversationMessageTable.externalMessageId} is not null`,
				// Sender is settled at first insert and must not be rewritten on
				// re-import: a guest message we sent through the channel comes back from
				// the provider classified as host, so re-applying `senderType` here would
				// flip our own messages to the wrong side.
				set: {
					body: message.body,
					deliveryStatus: "sent",
					isAutomatic: message.isAutomatic,
					rawPayload: message.raw,
					sentAt: message.sentAt,
					updatedAt: now,
				},
			})
			.returning({
				...conversationMessageSelection,
				inserted: sql<boolean>`xmax = 0`,
			});
		if (!row) {
			throw new CommerceError(
				"conversation_unavailable",
				"Could not import the message.",
				503,
			);
		}
		return { inserted: row.inserted, message: this.#toMessageDto(row) };
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

		const snapshot =
			input.type === "activity"
				? await this.#fetchQuoteSnapshot(
						{ quoteInput: input, type: "activity" },
						true,
					)
				: await this.#fetchQuoteSnapshot(
						{ quoteInput: input, type: "accommodation" },
						true,
					);
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
		if (current.type !== "accommodation") {
			throw new CommerceError(
				"item_not_editable",
				"Activity cart items cannot be edited in place.",
				422,
			);
		}
		const quoteInput = mergeQuoteInput(current.quoteInput, input);
		const snapshot = await this.#fetchAccommodationQuoteSnapshot(quoteInput);
		if (snapshot.validationStatus !== "valid") {
			throw new CommerceError(
				"dates_unavailable",
				"These dates are no longer available.",
				409,
			);
		}

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
					.set(
						snapshot.type === "activity"
							? {
									activityQuoteSnapshotId: snapshot.snapshot.id,
									updatedAt: new Date(),
								}
							: {
									quoteSnapshotId: snapshot.snapshot.id,
									updatedAt: new Date(),
								},
					)
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
			activityDetails: input.activityDetails ?? [],
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
		snapshot: NormalizedQuoteSnapshot,
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

		if (input.type === "accommodation") {
			if (isActivityQuoteSnapshot(snapshot)) {
				throw new CommerceError(
					"quote_snapshot_invalid",
					"Invalid quote snapshot.",
					500,
				);
			}
			await this.#assertNoOverlappingCartStay(tx, cartId, snapshot, {
				excludeItemId: itemId,
			});
		}

		if (existing) {
			await tx
				.update(cartItemTable)
				.set(
					input.type === "activity"
						? {
								activityQuoteSnapshotId: snapshot.id,
								quoteSnapshotId: null,
								removedAt: null,
								status: "active",
								type: "activity",
								updatedAt: now,
							}
						: {
								activityQuoteSnapshotId: null,
								quoteSnapshotId: snapshot.id,
								removedAt: null,
								status: "active",
								type: "accommodation",
								updatedAt: now,
							},
				)
				.where(eq(cartItemTable.id, itemId));
		} else {
			await tx.insert(cartItemTable).values({
				activityQuoteSnapshotId: input.type === "activity" ? snapshot.id : null,
				cartId,
				clientMutationId: input.clientMutationId,
				createdAt: now,
				id: itemId,
				position: await this.#nextCartPosition(tx, cartId),
				quoteSnapshotId: input.type === "accommodation" ? snapshot.id : null,
				status: "active",
				type: input.type,
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

		await this.#assertNoOverlappingCartStay(tx, cartId, snapshot, {
			excludeItemId: itemId,
		});

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
				.set(
					snapshot.type === "activity"
						? {
								activityQuoteSnapshotId: snapshot.snapshot.id,
								updatedAt: now,
							}
						: {
								quoteSnapshotId: snapshot.snapshot.id,
								updatedAt: now,
							},
				)
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

		const housingBases = orderSources.map((source) =>
			source.type === "accommodation" ? source.quote.housingFeeMinor : 0,
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
			dateOfBirth: input.contact.dateOfBirth,
			email: input.contact.email,
			firstName: input.contact.firstName,
			id: crypto.randomUUID(),
			isCompany: input.contact.isCompany,
			language: input.contact.language,
			lastName: input.contact.lastName,
			name: input.contact.name,
			notes: input.contact.notes,
			orderId,
			phoneE164: input.contact.phoneE164,
			taxNumber: input.contact.taxNumber,
		});

		const activityDetailByCartItem = new Map(
			(input.activityDetails ?? []).map((detail) => [
				detail.cartItemId,
				detail,
			]),
		);

		for (const [index, source] of orderSources.entries()) {
			if (source.type === "activity") {
				const rows = buildActivityDraftOrderRows(source, input.contact);
				const orderItemId = crypto.randomUUID();

				await tx.insert(orderItemTable).values({
					catalogSnapshot: rows.item.catalogSnapshot,
					createdAt: now,
					currency: rows.item.currency,
					discountMinor: 0,
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
					totalMinor: rows.item.totalMinor,
					type: rows.item.type,
					updatedAt: now,
				});

				const guestDetails = activityDetailByCartItem.get(
					rows.item.sourceCartItemId,
				);
				await tx.insert(activityItemDetailTable).values({
					activityDate: rows.detail.activityDate,
					// Guest answers/pickup are collected at checkout, not add-to-cart, so
					// they arrive on the draft-order body and override the empty quote
					// snapshot defaults when present.
					answers: guestDetails?.answers ?? rows.detail.answers,
					bokunActivityId: rows.detail.bokunActivityId,
					dropoffPlaceId: guestDetails?.dropoffPlaceId ?? null,
					externalAccountId: rows.detail.externalAccountId,
					orderItemId,
					participants: rows.detail.participants,
					pickupPlaceId: guestDetails?.pickupPlaceId ?? null,
					provider: rows.detail.provider,
					rateId: rows.detail.rateId,
					roomNumber: guestDetails?.roomNumber ?? null,
					startTimeId: rows.detail.startTimeId,
					totalParticipants: rows.detail.totalParticipants,
				});

				const providerBookingId = crypto.randomUUID();
				const activityStartsAt = stayDateToTimestamp(rows.detail.activityDate);
				await tx.insert(providerBookingTable).values({
					createdAt: now,
					externalAccountId: rows.detail.externalAccountId,
					// Reuses the guest-info reminder cadence to nudge the guest about
					// required provider questions left unanswered before the activity.
					guestReminderEmailNextAt: nextGuestInfoReminderAt(
						now,
						activityStartsAt,
					),
					id: providerBookingId,
					normalizedStatus: "pending",
					orderId,
					orderItemId,
					provider: rows.detail.provider,
					stayEndsAt: activityStartsAt,
					stayStartsAt: activityStartsAt,
					updatedAt: now,
				});

				if (rows.charges.length > 0) {
					await tx.insert(orderItemChargeTable).values(
						rows.charges.map((charge) => ({
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
				continue;
			}

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
			const stayStartsAt = stayDateToTimestamp(rows.detail.checkIn);
			const stayEndsAt = stayDateToTimestamp(rows.detail.checkOut);
			await tx.insert(providerBookingTable).values({
				createdAt: now,
				externalAccountId: rows.detail.externalAccountId,
				guestReminderEmailNextAt: nextGuestInfoReminderAt(now, stayStartsAt),
				id: providerBookingId,
				normalizedStatus: "pending",
				orderId,
				orderItemId,
				provider: rows.detail.provider,
				stayEndsAt,
				stayStartsAt,
				updatedAt: now,
			});

			if (rows.detail.guests > 0) {
				await tx.insert(bookingGuestTable).values(
					Array.from({ length: rows.detail.guests }, (_, position) => ({
						createdAt: now,
						id: crypto.randomUUID(),
						identityStatus: "missing" as const,
						orderId,
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
		input: ActiveQuoteInput,
		requireAvailable: boolean,
	): Promise<NormalizedQuoteSnapshot> {
		const snapshot =
			input.type === "activity"
				? await this.#fetchActivityQuoteSnapshot(input.quoteInput)
				: await this.#fetchAccommodationQuoteSnapshot(input.quoteInput);

		if (requireAvailable && snapshot.validationStatus !== "valid") {
			throw new CommerceError(
				input.type === "activity"
					? "activity_unavailable"
					: "dates_unavailable",
				input.type === "activity"
					? "This activity is no longer available."
					: "These dates are no longer available.",
				409,
			);
		}

		return snapshot;
	}

	async #fetchAccommodationQuoteSnapshot(
		input: CommerceQuoteInput,
	): Promise<NormalizedAccommodationQuoteSnapshot> {
		const quote = await this.#quoteAccommodation(input);
		return normalizeAccommodationQuoteSnapshot({
			accountId: this.#accountId,
			provider: this.#provider,
			quote,
			ttlSeconds: this.#quoteTtlSeconds,
		});
	}

	async #fetchActivityQuoteSnapshot(
		input: CommerceActivityQuoteInput,
	): Promise<NormalizedActivityQuoteSnapshot> {
		if (!this.#quoteActivity) {
			throw new CommerceError(
				"activity_booking_unavailable",
				"Activity booking is not available right now.",
				503,
			);
		}

		const quote = await this.#quoteActivity(input);
		return normalizeActivityQuoteSnapshot({
			accountId: this.#activityAccountId,
			provider: ACTIVITY_PROVIDER,
			quote,
			ttlSeconds: this.#quoteTtlSeconds,
		});
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
					snapshot: NormalizedQuoteSnapshot;
					type: "snapshot";
			  }
			| { error: CommerceError; input: ActiveItemInput; type: "failure" };

		const results = await Promise.allSettled(
			inputs.map(async (input): Promise<RevalidationAttempt> => {
				try {
					return {
						input,
						snapshot:
							input.type === "activity"
								? await this.#fetchQuoteSnapshot(
										{
											quoteInput: input.quoteInput,
											type: "activity",
										},
										false,
									)
								: await this.#fetchQuoteSnapshot(
										{
											quoteInput: input.quoteInput,
											type: "accommodation",
										},
										false,
									),
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
			snapshots.push({ itemId: input.itemId, snapshot, type: input.type });
			if (snapshot.validationStatus !== "valid") {
				failures.push({
					code:
						input.type === "activity"
							? "activity_unavailable"
							: "dates_unavailable",
					itemId: input.itemId,
					message:
						input.type === "activity"
							? "This activity is no longer available."
							: "These dates are no longer available.",
				});
			}
		}

		return { failures, snapshots };
	}

	async #insertQuoteSnapshot(
		tx: Transaction,
		snapshot: NormalizedQuoteSnapshot,
	): Promise<void> {
		if (isActivityQuoteSnapshot(snapshot)) {
			await tx.insert(activityQuoteSnapshotTable).values({
				activityDate: snapshot.activityDate,
				answers: snapshot.answers,
				bokunActivityId: snapshot.bokunActivityId,
				createdAt: new Date(),
				currency: snapshot.currency,
				expiresAt: snapshot.expiresAt,
				externalAccountId: snapshot.externalAccountId,
				fetchedAt: snapshot.fetchedAt,
				id: snapshot.id,
				participants: snapshot.participants,
				provider: snapshot.provider,
				providerPayload: snapshot.providerPayload,
				rateId: snapshot.rateId,
				startTimeId: snapshot.startTimeId,
				subtotalMinor: snapshot.subtotalMinor,
				taxMinor: snapshot.taxMinor,
				totalMinor: snapshot.totalMinor,
				totalParticipants: snapshot.totalParticipants,
				validationStatus: snapshot.validationStatus,
			});
			return;
		}

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
				activityAnswers: activityQuoteSnapshotTable.answers,
				activityDate: activityQuoteSnapshotTable.activityDate,
				activityId: activityQuoteSnapshotTable.bokunActivityId,
				activityParticipants: activityQuoteSnapshotTable.participants,
				activityRateId: activityQuoteSnapshotTable.rateId,
				activityStartTimeId: activityQuoteSnapshotTable.startTimeId,
				accommodationAdults: accommodationQuoteSnapshotTable.adults,
				accommodationCheckIn: accommodationQuoteSnapshotTable.checkIn,
				accommodationCheckOut: accommodationQuoteSnapshotTable.checkOut,
				accommodationChildren: accommodationQuoteSnapshotTable.children,
				accommodationGuests: accommodationQuoteSnapshotTable.guests,
				accommodationInfants: accommodationQuoteSnapshotTable.infants,
				accommodationListingId:
					accommodationQuoteSnapshotTable.listingExternalId,
				accommodationNights: accommodationQuoteSnapshotTable.nights,
				accommodationPets: accommodationQuoteSnapshotTable.pets,
				itemId: cartItemTable.id,
				itemType: cartItemTable.type,
				status: cartItemTable.status,
			})
			.from(cartItemTable)
			.leftJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				activityQuoteSnapshotTable,
				eq(
					cartItemTable.activityQuoteSnapshotId,
					activityQuoteSnapshotTable.id,
				),
			)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (row?.status !== "active") {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		return activeItemInputFromRow(row);
	}

	async #readActiveItemInputs(cartId: string): Promise<ActiveItemInput[]> {
		const now = new Date();
		await this.#ensureMutableCart(this.#db, cartId, now);
		const rows = await this.#db
			.select({
				activityAnswers: activityQuoteSnapshotTable.answers,
				activityDate: activityQuoteSnapshotTable.activityDate,
				activityId: activityQuoteSnapshotTable.bokunActivityId,
				activityParticipants: activityQuoteSnapshotTable.participants,
				activityRateId: activityQuoteSnapshotTable.rateId,
				activityStartTimeId: activityQuoteSnapshotTable.startTimeId,
				accommodationAdults: accommodationQuoteSnapshotTable.adults,
				accommodationCheckIn: accommodationQuoteSnapshotTable.checkIn,
				accommodationCheckOut: accommodationQuoteSnapshotTable.checkOut,
				accommodationChildren: accommodationQuoteSnapshotTable.children,
				accommodationGuests: accommodationQuoteSnapshotTable.guests,
				accommodationInfants: accommodationQuoteSnapshotTable.infants,
				accommodationListingId:
					accommodationQuoteSnapshotTable.listingExternalId,
				accommodationNights: accommodationQuoteSnapshotTable.nights,
				accommodationPets: accommodationQuoteSnapshotTable.pets,
				itemId: cartItemTable.id,
				itemType: cartItemTable.type,
				status: cartItemTable.status,
			})
			.from(cartItemTable)
			.leftJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				activityQuoteSnapshotTable,
				eq(
					cartItemTable.activityQuoteSnapshotId,
					activityQuoteSnapshotTable.id,
				),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			)
			.orderBy(asc(cartItemTable.position));

		return rows.map(activeItemInputFromRow);
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

	async #assertNoOverlappingCartStay(
		tx: Transaction,
		cartId: string,
		stay: NormalizedAccommodationQuoteSnapshot,
		options: { excludeItemId?: string } = {},
	): Promise<void> {
		const rows = await tx
			.select({
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				itemId: cartItemTable.id,
				listingId: accommodationQuoteSnapshotTable.listingExternalId,
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
					eq(
						accommodationQuoteSnapshotTable.listingExternalId,
						stay.listingExternalId,
					),
				),
			);

		const overlapping = findOverlappingStay(
			rows.filter((row) => row.itemId !== options.excludeItemId),
			{
				checkIn: stay.checkIn,
				checkOut: stay.checkOut,
				listingId: stay.listingExternalId,
			},
		);

		if (overlapping) {
			throw new CommerceError(
				"cart_item_overlap",
				"This stay overlaps dates already in your cart.",
				409,
			);
		}
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
				accommodationCurrency: accommodationQuoteSnapshotTable.currency,
				accommodationHousingFeeMinor:
					accommodationQuoteSnapshotTable.housingFeeMinor,
				accommodationSubtotalMinor:
					accommodationQuoteSnapshotTable.subtotalMinor,
				accommodationTaxMinor: accommodationQuoteSnapshotTable.taxMinor,
				accommodationTotalMinor: accommodationQuoteSnapshotTable.totalMinor,
				accommodationValidationStatus:
					accommodationQuoteSnapshotTable.validationStatus,
				activityCurrency: activityQuoteSnapshotTable.currency,
				activitySubtotalMinor: activityQuoteSnapshotTable.subtotalMinor,
				activityTaxMinor: activityQuoteSnapshotTable.taxMinor,
				activityTotalMinor: activityQuoteSnapshotTable.totalMinor,
				activityValidationStatus: activityQuoteSnapshotTable.validationStatus,
				itemType: cartItemTable.type,
			})
			.from(cartItemTable)
			.leftJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				activityQuoteSnapshotTable,
				eq(
					cartItemTable.activityQuoteSnapshotId,
					activityQuoteSnapshotTable.id,
				),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			);

		const totals = sumCartTotals(
			rows.map((row) =>
				row.itemType === "activity"
					? {
							currency: requiredRowValue(row.activityCurrency, "currency"),
							housingFeeMinor: 0,
							subtotalMinor: requiredRowValue(
								row.activitySubtotalMinor,
								"subtotal",
							),
							taxMinor: requiredRowValue(row.activityTaxMinor, "tax"),
							totalMinor: requiredRowValue(row.activityTotalMinor, "total"),
							validationStatus: requiredRowValue(
								row.activityValidationStatus,
								"validation status",
							),
						}
					: {
							currency: requiredRowValue(row.accommodationCurrency, "currency"),
							housingFeeMinor: row.accommodationHousingFeeMinor,
							subtotalMinor: requiredRowValue(
								row.accommodationSubtotalMinor,
								"subtotal",
							),
							taxMinor: requiredRowValue(row.accommodationTaxMinor, "tax"),
							totalMinor: requiredRowValue(
								row.accommodationTotalMinor,
								"total",
							),
							validationStatus: requiredRowValue(
								row.accommodationValidationStatus,
								"validation status",
							),
						},
			),
			this.#currency,
		);
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
		const rows = await db
			.select({
				activityAnswers: activityQuoteSnapshotTable.answers,
				activityCity: activityExperienceTable.city,
				activityCountry: activityExperienceTable.country,
				activityDate: activityQuoteSnapshotTable.activityDate,
				activityExternalAccountId: activityQuoteSnapshotTable.externalAccountId,
				activityFetchedAt: activityQuoteSnapshotTable.fetchedAt,
				activityId: activityQuoteSnapshotTable.bokunActivityId,
				activityParticipants: activityQuoteSnapshotTable.participants,
				activityProvider: activityQuoteSnapshotTable.provider,
				activityProviderPayload: activityQuoteSnapshotTable.providerPayload,
				activityQuoteCurrency: activityQuoteSnapshotTable.currency,
				activityQuoteExpiresAt: activityQuoteSnapshotTable.expiresAt,
				activityQuoteId: activityQuoteSnapshotTable.id,
				activityQuoteStatus: activityQuoteSnapshotTable.validationStatus,
				activityRateId: activityQuoteSnapshotTable.rateId,
				activityStartTimeId: activityQuoteSnapshotTable.startTimeId,
				activitySubtotalMinor: activityQuoteSnapshotTable.subtotalMinor,
				activitySummary: activityExperienceTable.summary,
				activityTaxMinor: activityQuoteSnapshotTable.taxMinor,
				activityTitle: activityExperienceTable.title,
				activityTotalMinor: activityQuoteSnapshotTable.totalMinor,
				activityTotalParticipants: activityQuoteSnapshotTable.totalParticipants,
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
				itemType: cartItemTable.type,
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
			.leftJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				activityQuoteSnapshotTable,
				eq(
					cartItemTable.activityQuoteSnapshotId,
					activityQuoteSnapshotTable.id,
				),
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
			.leftJoin(
				activityExperienceTable,
				and(
					eq(
						activityExperienceTable.provider,
						activityQuoteSnapshotTable.provider,
					),
					eq(
						activityExperienceTable.externalAccountId,
						activityQuoteSnapshotTable.externalAccountId,
					),
					eq(
						activityExperienceTable.externalId,
						activityQuoteSnapshotTable.bokunActivityId,
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

		return rows.map(cartJoinedRowFromDb);
	}

	async #orderSources(
		tx: Transaction,
		cartId: string,
		now: Date,
	): Promise<OrderSource[]> {
		const rows = await this.#cartRows(tx, cartId);
		const sources: OrderSource[] = [];

		for (const row of rows) {
			const quote =
				row.itemType === "activity"
					? activityQuoteSnapshotFromRow(row)
					: quoteSnapshotFromRow(row);
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
				snapshot:
					row.itemType === "activity"
						? activityCatalogSnapshot(row)
						: listingSnapshot(row),
				type: row.itemType,
			} as OrderSource);
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
				// Recoverable bad input: leave the order draft and any sibling holds in
				// place so the guest can fix the details and retry without re-holding.
				if ("invalid" in result) {
					return { message: result.invalid, outcome: "invalid" };
				}
				await this.#releaseHeldSiblings(context, booking.providerBookingId);
				await this.#failOrder(orderId, "reservation_unavailable");
				return { message: result.unavailable, outcome: "unavailable" };
			}
			if (result === "permanent") {
				await this.#releaseHeldSiblings(context, booking.providerBookingId);
				await this.#failOrder(orderId, "reservation_create_failed");
				return {
					message: "This booking can no longer be completed.",
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
		let sawNotSettled = false;
		for (const booking of context.bookings) {
			const result = await this.#confirmHold(booking, order);
			if (result === "transient") {
				sawTransient = true;
			} else if (result === "permanent") {
				sawPermanent = true;
			} else if (result === "not_settled") {
				sawNotSettled = true;
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

		// A still-pending accept (`not_settled`) leaves the order pending for the
		// cron exactly like a transient confirm, but is deliberately kept out of the
		// `sawPermanent` path above so it can never trigger a refund on a live hold.
		if (sawTransient || sawNotSettled) {
			return {
				outcome: "pending_retry",
				pending: this.#buildConfirmationFacts(context),
			};
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

	/**
	 * Atomically claims the pending-notice email for an order, returning `true`
	 * only to the caller that wins the claim. Reuses the finalization claim window
	 * so a crash mid-send is retried by a later reconciler pass. Independent of the
	 * `finalizationEmail*` slot because the notice precedes (not replaces) the
	 * confirmation email for the same order.
	 */
	async claimPendingNoticeEmail(orderId: string): Promise<boolean> {
		const now = new Date();
		const claimExpiresAt = new Date(
			now.getTime() + FINALIZATION_EMAIL_CLAIM_MS,
		);
		const [updated] = await this.#db
			.update(orderTable)
			.set({
				pendingNoticeEmailNextAttemptAt: claimExpiresAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					isNull(orderTable.pendingNoticeEmailSentAt),
					lte(orderTable.pendingNoticeEmailNextAttemptAt, now),
				),
			)
			.returning({ id: orderTable.id });
		return Boolean(updated);
	}

	async markPendingNoticeEmailSent(orderId: string): Promise<void> {
		const now = new Date();
		await this.#db
			.update(orderTable)
			.set({ pendingNoticeEmailSentAt: now, updatedAt: now })
			.where(
				and(
					eq(orderTable.id, orderId),
					isNull(orderTable.pendingNoticeEmailSentAt),
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
			onPendingNotice?: (facts: OrderConfirmationFacts) => Promise<void>;
		} = {},
	): Promise<ReconcileReservationsSummary> {
		const now = options.now ?? new Date();
		const limit = options.limit ?? 50;
		const handlers = {
			onCompensated: options.onCompensated,
			onConfirmed: options.onConfirmed,
			onPendingNotice: options.onPendingNotice,
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
							// A hold whose accept will not settle is flagged `needsRecovery`
							// for the operator yet must keep getting its daily nudge, so it
							// is selected despite the flag via its distinct error code.
							or(
								eq(providerBookingTable.needsRecovery, false),
								eq(providerBookingTable.lastErrorCode, "confirm_not_settled"),
							),
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
					paymentMethod: live.paymentMethod,
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
			await this.#dispatchPendingNoticeEmail(result.pending, handlers);
		}
	}

	/**
	 * Sends the "payment received, finalizing your booking" courtesy email while an
	 * order sits `pending` awaiting hold confirmation. Deduped by its own
	 * `pendingNoticeEmail*` slot so a re-delivered webhook and this reconciler pass
	 * never double-send. Best-effort: a send failure leaves the claim to lapse for
	 * a later retry and never blocks the authoritative confirmation email.
	 */
	async #dispatchPendingNoticeEmail(
		facts: OrderConfirmationFacts,
		handlers: ReconcileHandlers,
	): Promise<void> {
		if (!facts.email || !handlers.onPendingNotice) {
			return;
		}
		if (!(await this.claimPendingNoticeEmail(facts.orderId))) {
			return;
		}
		try {
			await handlers.onPendingNotice(facts);
		} catch {
			return;
		}
		try {
			await this.markPendingNoticeEmailSent(facts.orderId);
		} catch {
			// The email went out; failing to record it only risks a rare duplicate
			// on the next pass, which is acceptable for a courtesy notice.
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
				stripePaymentMethodBrand: orderTable.stripePaymentMethodBrand,
				stripePaymentMethodLast4: orderTable.stripePaymentMethodLast4,
				stripePaymentMethodType: orderTable.stripePaymentMethodType,
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
				dateOfBirth: orderContactTable.dateOfBirth,
				email: orderContactTable.email,
				firstName: orderContactTable.firstName,
				language: orderContactTable.language,
				lastName: orderContactTable.lastName,
				name: orderContactTable.name,
				phoneE164: orderContactTable.phoneE164,
			})
			.from(orderContactTable)
			.where(eq(orderContactTable.orderId, orderId))
			.limit(1);

		const bookingRows = await db
			.select({
				accommodationExternalAccountId:
					accommodationItemDetailTable.externalAccountId,
				activityAnswers: activityItemDetailTable.answers,
				activityDate: activityItemDetailTable.activityDate,
				activityExternalAccountId: activityItemDetailTable.externalAccountId,
				bokunActivityId: activityItemDetailTable.bokunActivityId,
				dropoffPlaceId: activityItemDetailTable.dropoffPlaceId,
				pickupPlaceId: activityItemDetailTable.pickupPlaceId,
				roomNumber: activityItemDetailTable.roomNumber,
				attemptCount: providerBookingTable.attemptCount,
				checkIn: accommodationItemDetailTable.checkIn,
				checkOut: accommodationItemDetailTable.checkOut,
				guests: accommodationItemDetailTable.guests,
				hostifyListingId: accommodationItemDetailTable.hostifyListingId,
				imageUrlSnapshot: orderItemTable.imageUrlSnapshot,
				itemTotalMinor: orderItemTable.totalMinor,
				itemType: orderItemTable.type,
				normalizedStatus: providerBookingTable.normalizedStatus,
				orderItemId: orderItemTable.id,
				participants: activityItemDetailTable.participants,
				pets: accommodationItemDetailTable.pets,
				provider: providerBookingTable.provider,
				providerBookingId: providerBookingTable.id,
				providerExternalAccountId: providerBookingTable.externalAccountId,
				providerReservationId: providerBookingTable.providerReservationId,
				providerTransactionId: providerBookingTable.providerTransactionId,
				rateId: activityItemDetailTable.rateId,
				startTimeId: activityItemDetailTable.startTimeId,
				titleSnapshot: orderItemTable.titleSnapshot,
				totalParticipants: activityItemDetailTable.totalParticipants,
			})
			.from(providerBookingTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.leftJoin(
				accommodationItemDetailTable,
				eq(accommodationItemDetailTable.orderItemId, orderItemTable.id),
			)
			.leftJoin(
				activityItemDetailTable,
				eq(activityItemDetailTable.orderItemId, orderItemTable.id),
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

		const bookings: SagaBooking[] = bookingRows.map((row) => {
			const base = {
				attemptCount: row.attemptCount,
				charges: chargesByItem.get(row.orderItemId) ?? [],
				externalAccountId:
					row.providerExternalAccountId ??
					(row.itemType === "activity"
						? requiredRowValue(
								row.activityExternalAccountId,
								"activity external account id",
							)
						: requiredRowValue(
								row.accommodationExternalAccountId,
								"accommodation external account id",
							)),
				imageUrlSnapshot: row.imageUrlSnapshot,
				itemTotalMinor: row.itemTotalMinor,
				normalizedStatus: row.normalizedStatus,
				orderItemId: row.orderItemId,
				provider: row.provider,
				providerBookingId: row.providerBookingId,
				providerReservationId: row.providerReservationId,
				providerTransactionId: row.providerTransactionId,
				titleSnapshot: row.titleSnapshot,
			};

			if (row.itemType === "activity") {
				return {
					...base,
					activityAnswers: row.activityAnswers ?? [],
					activityDate: requiredRowValue(row.activityDate, "activity date"),
					bokunActivityId: requiredRowValue(
						row.bokunActivityId,
						"bokun activity id",
					),
					dropoffPlaceId: row.dropoffPlaceId,
					itemType: "activity",
					participants: row.participants ?? [],
					pickupPlaceId: row.pickupPlaceId,
					rateId: row.rateId,
					roomNumber: row.roomNumber,
					startTimeId: row.startTimeId,
					totalParticipants: requiredRowValue(
						row.totalParticipants,
						"activity total participants",
					),
				};
			}

			return {
				...base,
				checkIn: requiredRowValue(row.checkIn, "check in"),
				checkOut: requiredRowValue(row.checkOut, "check out"),
				guests: requiredRowValue(row.guests, "guests"),
				hostifyListingId: requiredRowValue(
					row.hostifyListingId,
					"hostify listing id",
				),
				itemType: "accommodation",
				pets: requiredRowValue(row.pets, "pets"),
			};
		});

		return {
			bookings,
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

			if (currentBooking.itemType === "accommodation") {
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
			}

			const holdRequest =
				currentBooking.itemType === "activity"
					? ({
							activity: {
								activityDate: currentBooking.activityDate,
								answers: currentBooking.activityAnswers,
								bokunActivityId: currentBooking.bokunActivityId,
								dropoffPlaceId: currentBooking.dropoffPlaceId,
								participants: currentBooking.participants,
								pickupPlaceId: currentBooking.pickupPlaceId,
								rateId: currentBooking.rateId,
								roomNumber: currentBooking.roomNumber,
								startTimeId: currentBooking.startTimeId,
							},
							amountMinor: currentBooking.itemTotalMinor,
							contact: {
								dateOfBirth: context.contact.dateOfBirth,
								email: context.contact.email,
								firstName: context.contact.firstName,
								language: context.contact.language,
								lastName: context.contact.lastName,
								name: context.contact.name,
								phone: context.contact.phoneE164,
							},
							currency: context.order.currency,
							kind: "bokun_activity",
							orderItemId: currentBooking.orderItemId,
							publicReference: context.order.publicReference,
							source: this.#reservationSource,
						} satisfies BokunActivityHoldRequest)
					: buildHoldRequest({
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
						});
			const result = await gateway.placeHold(holdRequest);

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
				case "invalid":
					// Do not mark the booking: the guest fixes the details and retries,
					// which re-submits this same booking.
					return { invalid: result.message };
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
		order: SagaContext["order"],
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
			amountMinor: prepared.booking.itemTotalMinor,
			currency: order.currency,
			paymentReference: order.stripePaymentIntentId,
			publicReference: order.publicReference,
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
			if (result.kind === "not_settled") {
				await this.#recordConfirmNotSettled(
					currentBooking,
					result.providerStatus,
					result.raw,
					tx,
				);
				return "not_settled";
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

	/**
	 * Records a confirm whose accept has not taken on the provider yet (the hold is
	 * alive and `pending`, the payment captured). This is never a failure and never
	 * compensates: refunding a paid, still-held booking would be wrong. The booking
	 * stays `pending` and is retried — first on the standard backoff, then daily
	 * once the grace count is passed, at which point `needsRecovery` is set so an
	 * operator can finish the accept by hand. The reconciler's `pending` selection
	 * is widened to keep nudging these despite the `needsRecovery` flag.
	 */
	async #recordConfirmNotSettled(
		booking: SagaBooking,
		providerStatus: string | null,
		raw: Record<string, unknown>,
		db: DbExecutor = this.#db,
	): Promise<void> {
		const now = new Date();
		const attemptCount = booking.attemptCount + 1;
		const gracePassed = attemptCount >= CONFIRM_SETTLE_GRACE_ATTEMPTS;
		await db
			.update(providerBookingTable)
			.set({
				attemptCount,
				lastAttemptAt: now,
				lastErrorCode: "confirm_not_settled",
				lastErrorMessage: `Provider confirmation has not settled; reservation still ${providerStatus ?? "unconfirmed"}.`,
				needsRecovery: gracePassed,
				nextAttemptAt: gracePassed
					? new Date(now.getTime() + RESERVATION_SETTLE_RETRY_MS)
					: this.#backoffFrom(now, attemptCount),
				providerStatus,
				providerUpdatedAt: now,
				rawOperationalPayload: raw,
				updatedAt: now,
			})
			.where(eq(providerBookingTable.id, booking.providerBookingId));

		// Alert the operator exactly once, when the grace count is first crossed.
		if (attemptCount === CONFIRM_SETTLE_GRACE_ATTEMPTS) {
			trackEvent({
				metadata: {
					attemptCount,
					orderItemId: booking.orderItemId,
					providerBookingId: booking.providerBookingId,
					providerReservationId: booking.providerReservationId,
					providerStatus,
				},
				name: "reservation_confirm_stuck",
				provider: this.#provider,
				severity: "warning",
				type: "integration",
			});
		}
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
		return {
			activities: context.bookings
				.filter(
					(booking): booking is ActivitySagaBooking =>
						booking.itemType === "activity",
				)
				.map((booking) => ({
					activityDate: booking.activityDate,
					imageUrl: booking.imageUrlSnapshot,
					productConfirmationCode: booking.providerTransactionId,
					title: booking.titleSnapshot ?? "Your Alojamento Ideal activity",
					totalParticipants: booking.totalParticipants,
				})),
			amountPaidMinor: context.order.amountPaidMinor,
			billingAddress: context.contact?.billingAddress ?? {},
			contactPhone: context.contact?.phoneE164 ?? "",
			currency: context.order.currency,
			email: context.contact?.email ?? "",
			name: context.contact?.name ?? "",
			orderId: context.order.id,
			paymentMethod: paymentMethodFromOrderRow(context.order),
			publicReference: context.order.publicReference,
			stays: context.bookings
				.filter(
					(booking): booking is AccommodationSagaBooking =>
						booking.itemType === "accommodation",
				)
				.map((booking) => ({
					checkIn: booking.checkIn,
					checkOut: booking.checkOut,
					guests: booking.guests,
					imageUrl: booking.imageUrlSnapshot,
					nights: nightsBetweenStayDates(booking.checkIn, booking.checkOut),
					title: booking.titleSnapshot ?? "Your Alojamento Ideal stay",
				})),
		};
	}
}

/** Nights between two `YYYY-MM-DD` stay dates; 0 when either is malformed. */
function nightsBetweenStayDates(checkIn: string, checkOut: string): number {
	const inMs = Date.parse(`${checkIn}T00:00:00Z`);
	const outMs = Date.parse(`${checkOut}T00:00:00Z`);
	if (Number.isNaN(inMs) || Number.isNaN(outMs)) {
		return 0;
	}
	return Math.max(0, Math.round((outMs - inMs) / 86_400_000));
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

function isBookingGuestMemberConflict(error: unknown): boolean {
	const pgError = findPostgresError(error);
	return (
		pgError?.code === "23505" &&
		pgError.constraint === "booking_guests_booking_member_uidx"
	);
}

function guestAlreadyInStayError(status: OrderMemberStatus): CommerceError {
	return new CommerceError(
		"order_member_exists",
		status === "active"
			? "That guest already has a spot on this stay."
			: "That guest is already invited to this stay.",
		409,
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

interface ActiveItemInputDbRow {
	activityAnswers: NormalizedActivityQuoteSnapshot["answers"] | null;
	activityDate: string | null;
	activityId: string | null;
	activityParticipants: NormalizedActivityQuoteSnapshot["participants"] | null;
	activityRateId: string | null;
	activityStartTimeId: string | null;
	accommodationAdults: number | null;
	accommodationCheckIn: string | null;
	accommodationCheckOut: string | null;
	accommodationChildren: number | null;
	accommodationGuests: number | null;
	accommodationInfants: number | null;
	accommodationListingId: string | null;
	accommodationNights: number | null;
	accommodationPets: number | null;
	itemId: string;
	itemType: string;
}

interface CartJoinedDbRow {
	activityAnswers: NormalizedActivityQuoteSnapshot["answers"] | null;
	activityCity: string | null;
	activityCountry: string | null;
	activityDate: string | null;
	activityExternalAccountId: string | null;
	activityFetchedAt: Date | null;
	activityId: string | null;
	activityParticipants: NormalizedActivityQuoteSnapshot["participants"] | null;
	activityProvider: string | null;
	activityProviderPayload: Record<string, unknown> | null;
	activityQuoteCurrency: string | null;
	activityQuoteExpiresAt: Date | null;
	activityQuoteId: string | null;
	activityQuoteStatus: string | null;
	activityRateId: string | null;
	activityStartTimeId: string | null;
	activitySubtotalMinor: number | null;
	activitySummary: unknown | null;
	activityTaxMinor: number | null;
	activityTitle: string | null;
	activityTotalMinor: number | null;
	activityTotalParticipants: number | null;
	cartItemId: string;
	checkIn: string | null;
	checkOut: string | null;
	city: string | null;
	country: string | null;
	currency: string | null;
	externalAccountId: string | null;
	feeLines: NormalizedAccommodationQuoteSnapshot["feeLines"] | null;
	fetchedAt: Date | null;
	guests: number | null;
	housingFeeMinor: number | null;
	imageFallbackName: string | null;
	infants: number | null;
	itemType: string;
	listingExternalId: string | null;
	nightlyAverageMinor: number | null;
	nights: number | null;
	pets: number | null;
	position: number;
	processed: AccommodationListingProcessedContent | null;
	provider: string | null;
	providerPayload: Record<string, unknown> | null;
	quoteAdults: number | null;
	quoteChildren: number | null;
	quoteCleaningFeeMinor: number | null;
	quoteExpiresAt: Date | null;
	quoteId: string | null;
	quoteStatus: string | null;
	raw: AccommodationListingRawContent | null;
	subtotalMinor: number | null;
	taxMinor: number | null;
	timezone: string | null;
	totalMinor: number | null;
	updatedAt: Date;
}

function requiredRowValue<T>(value: T | null | undefined, field: string): T {
	if (value === null || value === undefined) {
		throw new CommerceError(
			"quote_snapshot_invalid",
			`Cart item is missing ${field}.`,
			500,
		);
	}
	return value;
}

function isActivityQuoteSnapshot(
	snapshot: NormalizedQuoteSnapshot,
): snapshot is NormalizedActivityQuoteSnapshot {
	return "bokunActivityId" in snapshot;
}

function activeItemInputFromRow(row: ActiveItemInputDbRow): ActiveItemInput {
	if (row.itemType === "activity") {
		return {
			itemId: row.itemId,
			quoteInput: {
				activityDate: requiredRowValue(row.activityDate, "activity date"),
				activityId: requiredRowValue(row.activityId, "activity id"),
				answers: row.activityAnswers ?? [],
				participants: requiredRowValue(
					row.activityParticipants,
					"activity participants",
				).map((participant) => ({
					count: participant.count,
					pricingCategoryId: participant.pricingCategoryId,
				})),
				rateId: row.activityRateId,
				startTimeId: row.activityStartTimeId,
			},
			type: "activity",
		};
	}

	if (row.itemType !== "accommodation") {
		throw new CommerceError(
			"quote_snapshot_invalid",
			"Cart item has an unsupported type.",
			500,
		);
	}

	return {
		itemId: row.itemId,
		quoteInput: {
			adults: requiredRowValue(row.accommodationAdults, "adults"),
			children: requiredRowValue(row.accommodationChildren, "children"),
			dates: {
				checkIn: requiredRowValue(row.accommodationCheckIn, "check-in"),
				checkOut: requiredRowValue(row.accommodationCheckOut, "check-out"),
				nights: requiredRowValue(row.accommodationNights, "nights"),
			},
			guests: requiredRowValue(row.accommodationGuests, "guests"),
			infants: requiredRowValue(row.accommodationInfants, "infants"),
			listingId: requiredRowValue(row.accommodationListingId, "listing id"),
			pets: requiredRowValue(row.accommodationPets, "pets"),
		},
		type: "accommodation",
	};
}

function cartJoinedRowFromDb(row: CartJoinedDbRow): CartJoinedRow {
	if (row.itemType === "activity") {
		return {
			activityAnswers: row.activityAnswers ?? [],
			activityDate: requiredRowValue(row.activityDate, "activity date"),
			activityId: requiredRowValue(row.activityId, "activity id"),
			activitySummary: row.activitySummary,
			activityTitle: row.activityTitle,
			cartItemId: row.cartItemId,
			city: row.activityCity,
			country: row.activityCountry,
			currency: requiredRowValue(row.activityQuoteCurrency, "currency"),
			externalAccountId: requiredRowValue(
				row.activityExternalAccountId,
				"external account id",
			),
			fetchedAt: requiredRowValue(row.activityFetchedAt, "fetched at"),
			itemType: "activity",
			participants: row.activityParticipants ?? [],
			position: row.position,
			provider: requiredRowValue(row.activityProvider, "provider"),
			providerPayload: row.activityProviderPayload,
			quoteExpiresAt: requiredRowValue(
				row.activityQuoteExpiresAt,
				"quote expiry",
			),
			quoteId: requiredRowValue(row.activityQuoteId, "quote id"),
			quoteStatus: requiredRowValue(row.activityQuoteStatus, "quote status"),
			rateId: row.activityRateId,
			startTimeId: row.activityStartTimeId,
			subtotalMinor: requiredRowValue(row.activitySubtotalMinor, "subtotal"),
			taxMinor: requiredRowValue(row.activityTaxMinor, "tax"),
			totalMinor: requiredRowValue(row.activityTotalMinor, "total"),
			totalParticipants: requiredRowValue(
				row.activityTotalParticipants,
				"total participants",
			),
			updatedAt: row.updatedAt,
		};
	}

	if (row.itemType !== "accommodation") {
		throw new CommerceError(
			"quote_snapshot_invalid",
			"Cart item has an unsupported type.",
			500,
		);
	}

	return {
		cartItemId: row.cartItemId,
		checkIn: requiredRowValue(row.checkIn, "check-in"),
		checkOut: requiredRowValue(row.checkOut, "check-out"),
		city: row.city,
		country: row.country,
		currency: requiredRowValue(row.currency, "currency"),
		externalAccountId: requiredRowValue(
			row.externalAccountId,
			"external account id",
		),
		feeLines: requiredRowValue(row.feeLines, "fee lines"),
		fetchedAt: requiredRowValue(row.fetchedAt, "fetched at"),
		guests: requiredRowValue(row.guests, "guests"),
		housingFeeMinor: row.housingFeeMinor,
		imageFallbackName: row.imageFallbackName,
		infants: requiredRowValue(row.infants, "infants"),
		itemType: "accommodation",
		listingExternalId: requiredRowValue(row.listingExternalId, "listing id"),
		nightlyAverageMinor: row.nightlyAverageMinor,
		nights: requiredRowValue(row.nights, "nights"),
		pets: requiredRowValue(row.pets, "pets"),
		position: row.position,
		processed: row.processed,
		provider: requiredRowValue(row.provider, "provider"),
		providerPayload: row.providerPayload,
		quoteAdults: requiredRowValue(row.quoteAdults, "adults"),
		quoteChildren: requiredRowValue(row.quoteChildren, "children"),
		quoteCleaningFeeMinor: row.quoteCleaningFeeMinor,
		quoteExpiresAt: requiredRowValue(row.quoteExpiresAt, "quote expiry"),
		quoteId: requiredRowValue(row.quoteId, "quote id"),
		quoteStatus: requiredRowValue(row.quoteStatus, "quote status"),
		raw: row.raw,
		subtotalMinor: requiredRowValue(row.subtotalMinor, "subtotal"),
		taxMinor: requiredRowValue(row.taxMinor, "tax"),
		timezone: row.timezone,
		totalMinor: requiredRowValue(row.totalMinor, "total"),
		updatedAt: row.updatedAt,
	};
}

function toCartItemDto(row: CartJoinedRow, now: Date): CartItemDto {
	const quote = quoteDto(row, now);
	if (row.itemType === "activity") {
		const snapshot = activityCatalogSnapshot(row);
		return {
			activityDate: row.activityDate,
			activityId: row.activityId,
			currency: row.currency,
			id: row.cartItemId,
			imageUrl: snapshot.imageUrl,
			participants: row.participants,
			position: row.position,
			quote,
			rateId: row.rateId,
			startTimeId: row.startTimeId,
			status: "active",
			subtotalMinor: row.subtotalMinor,
			taxMinor: row.taxMinor,
			title: snapshot.title,
			totalMinor: row.totalMinor,
			totalParticipants: row.totalParticipants,
			type: "activity",
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	const snapshot = listingSnapshot(row);

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
		feeLines: row.itemType === "activity" ? [] : row.feeLines,
		fetchedAt: row.fetchedAt.toISOString(),
		id: row.quoteId,
		status,
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
	};
}

function quoteSnapshotFromRow(
	row: AccommodationCartJoinedRow,
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

function activityQuoteSnapshotFromRow(
	row: ActivityCartJoinedRow,
): NormalizedActivityQuoteSnapshot {
	return {
		activityDate: row.activityDate,
		answers: row.activityAnswers,
		bokunActivityId: row.activityId,
		currency: row.currency,
		expiresAt: row.quoteExpiresAt,
		externalAccountId: row.externalAccountId,
		fetchedAt: row.fetchedAt,
		id: row.quoteId,
		participants: row.participants,
		provider: row.provider,
		providerPayload: row.providerPayload ?? {},
		rateId: row.rateId,
		startTimeId: row.startTimeId,
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
		totalParticipants: row.totalParticipants,
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

function listingSnapshot(
	row: AccommodationCartJoinedRow,
): ListingDisplaySnapshot {
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

function activityCatalogSnapshot(
	row: ActivityCartJoinedRow,
): CommerceCatalogSnapshot {
	const summary = activitySummaryRecord(row.activitySummary);
	const coverPhoto = recordValue(summary, "coverPhoto");
	const location = recordValue(summary, "location");
	const city = stringValue(recordValue(location, "city")) ?? row.city;
	const country = stringValue(recordValue(location, "country")) ?? row.country;
	const imageUrl =
		stringValue(recordValue(coverPhoto, "url")) ??
		stringValue(recordValue(coverPhoto, "thumbnailUrl"));
	const title =
		stringValue(recordValue(summary, "title")) ??
		row.activityTitle?.trim() ??
		row.activityId;

	return {
		city,
		country,
		imageUrl,
		listingId: row.activityId,
		locationLabel: [city, country].filter(Boolean).join(", ") || null,
		provider: row.provider,
		title,
	};
}

function activitySummaryRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function recordValue(value: unknown, key: string): unknown {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)[key]
		: null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
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
