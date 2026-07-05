import {
	type AccommodationQuoteResult,
	AccommodationQuoteService,
	getAccommodationsConfigFromSettings,
} from "@workspace/core/accommodations";
import {
	CommerceError,
	type CommerceIssue,
	type CommerceParseResult,
	type CommerceQuoteInput,
	CommerceService,
	HostifyConversationGateway,
	HostifyReservationGateway,
	mapStripePaymentStatus,
	OrderRefundService,
	type ProviderReservationGateway,
	ReservationAdminService,
	type ResolvedOrderAccess,
	StubReservationGateway,
} from "@workspace/core/commerce";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import {
	createRefund,
	createStripeClientFromEnv,
	resolvePromotionCode,
	retrievePaymentIntentSnapshot,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { getRedis } from "@workspace/core/redis";
import { getRuntimeSettings } from "@workspace/core/settings";
import type { AppliedDiscountSnapshot } from "@workspace/db";
import { getDb, order } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createPusherRealtimePublisher } from "./realtime";

export const HOSTIFY_PROVIDER = "hostify";

let warnedHostifyDisabled = false;

function resolveHostifyGateway(
	hostifyClient: ReturnType<typeof createHostifyClientFromEnv>,
	hostifyBookingsEnabled: boolean,
): ProviderReservationGateway {
	if (hostifyBookingsEnabled) {
		return new HostifyReservationGateway({ client: hostifyClient });
	}
	if (!warnedHostifyDisabled) {
		warnedHostifyDisabled = true;
		console.warn(
			"HOSTIFY_BOOKINGS_ENABLED=false: reservation saga is running in dry-run mode; no real Hostify bookings will be created.",
		);
	}
	return new StubReservationGateway();
}

function optionalStripeClient(): ReturnType<
	typeof createStripeClientFromEnv
> | null {
	try {
		return createStripeClientFromEnv();
	} catch (error) {
		if (error instanceof StripeConfigurationError) {
			return null;
		}
		throw error;
	}
}

/**
 * Request-scoped CommerceService for admin operations. Mirrors the web app's
 * factory minus cart quote error mapping. Admin conversation replies still use
 * the same Hostify inbox gateway and realtime publisher as the guest surface.
 */
export async function commerceService(): Promise<CommerceService> {
	const [config, settings] = await Promise.all([
		getAccommodationsConfigFromSettings(),
		getRuntimeSettings(),
	]);
	const hostifyClient = createHostifyClientFromEnv();
	const stripe = optionalStripeClient();
	const hostifyBookingsEnabled =
		settings["features.hostifyBookingsEnabled"] === true;
	const quoteService = new AccommodationQuoteService({
		client: hostifyClient,
		currency: config.currency,
		redis: getRedis(),
		ttlSeconds: config.quoteCacheTtlSeconds,
	});

	return new CommerceService({
		accountId: config.hostifyAccountId,
		autoRefundOnFailure:
			settings["features.commerceAutoRefund"] === true && stripe !== null,
		currency: config.currency,
		db: getDb(),
		provider: HOSTIFY_PROVIDER,
		quoteAccommodation: async (
			input: CommerceQuoteInput,
		): Promise<AccommodationQuoteResult> =>
			quoteService.quote({
				...input,
				accountId: config.hostifyAccountId,
				forceFresh: input.forceFresh ?? false,
				providerId: HOSTIFY_PROVIDER,
			}),
		quoteTtlSeconds: config.quoteCacheTtlSeconds,
		refundPayment: stripe
			? (request) => createRefund(stripe, request)
			: undefined,
		resolveDiscount: async (
			code: string,
		): Promise<AppliedDiscountSnapshot | null> => {
			if (!stripe) {
				throw new CommerceError(
					"discount_unavailable",
					"Discounts are not available right now.",
					503,
				);
			}
			return resolvePromotionCode(stripe, code);
		},
		resolveReservationGateway: (provider) =>
			provider === HOSTIFY_PROVIDER
				? resolveHostifyGateway(hostifyClient, hostifyBookingsEnabled)
				: undefined,
		resolveConversationGateway: (provider) =>
			provider === HOSTIFY_PROVIDER
				? new HostifyConversationGateway({ client: hostifyClient })
				: undefined,
		realtimePublisher: createPusherRealtimePublisher(),
		retrievePaymentIntent: stripe
			? async (paymentIntentId) => {
					const snapshot = await retrievePaymentIntentSnapshot(
						stripe,
						paymentIntentId,
						{ includePaymentMethod: true },
					);
					return {
						amountMinor: snapshot.amountMinor,
						currency: snapshot.currency,
						paymentMethod: snapshot.paymentMethod,
						status: mapStripePaymentStatus(snapshot.status),
					};
				}
			: undefined,
	});
}

/**
 * Request-scoped service for operator-issued manual refunds. Shares the same
 * optional Stripe wiring as {@link commerceService}: when Stripe is not
 * configured the service still constructs, but `refundOrder` rejects with
 * `refund_unavailable`.
 */
export function orderRefundService(): OrderRefundService {
	const stripe = optionalStripeClient();
	return new OrderRefundService({
		db: getDb(),
		refundPayment: stripe
			? (request) => createRefund(stripe, request)
			: undefined,
	});
}

/**
 * Request-scoped service for per-reservation Hostify management (status,
 * dates, guest count). In the HOSTIFY_BOOKINGS_ENABLED=false dry-run it gets a
 * null client and only syncs local booking state, mirroring the saga.
 */
export async function reservationAdminService(): Promise<ReservationAdminService> {
	const settings = await getRuntimeSettings();
	const hostifyBookingsEnabled =
		settings["features.hostifyBookingsEnabled"] === true;
	return new ReservationAdminService({
		db: getDb(),
		hostify: hostifyBookingsEnabled ? createHostifyClientFromEnv() : null,
	});
}

export function normalizedOrderReference(reference: string): string {
	return reference.trim().toUpperCase();
}

export interface AdminOrderRow {
	amountPaidMinor: number;
	amountRefundedMinor: number;
	id: string;
	publicReference: string;
	status: string;
	userId: string | null;
}

/** Loads the minimal order row admin actions key off, by public reference. */
export async function loadAdminOrder(
	reference: string,
): Promise<AdminOrderRow | null> {
	const [row] = await getDb()
		.select({
			amountPaidMinor: order.amountPaidMinor,
			amountRefundedMinor: order.amountRefundedMinor,
			id: order.id,
			publicReference: order.publicReference,
			status: order.status,
			userId: order.userId,
		})
		.from(order)
		.where(eq(order.publicReference, normalizedOrderReference(reference)))
		.limit(1);
	return row ?? null;
}

export async function deleteAdminOrder(row: AdminOrderRow): Promise<boolean> {
	const deleted = await getDb()
		.delete(order)
		.where(eq(order.id, row.id))
		.returning({ id: order.id });
	return deleted.length > 0;
}

/**
 * Synthesizes an owner-role access grant for an operator. Admin routes are
 * already gated on the Better Auth admin role, so the commerce permission
 * matrix sees the operator as the order owner (full access) without a cart
 * or member token.
 */
export function adminOrderAccess(row: AdminOrderRow): ResolvedOrderAccess {
	return {
		member: null,
		order: {
			cartToken: null,
			id: row.id,
			publicReference: row.publicReference,
			status: row.status,
			userId: row.userId,
		},
		role: "owner",
	};
}

export function validationResponse<T>(
	parsed: Extract<CommerceParseResult<T>, { success: false }>,
	message = "Invalid request",
): Response {
	return Response.json(
		{
			code: "invalid_request",
			error: message,
			issues: parsed.error.issues.map((issue) => ({
				message: issue.message,
				path: issue.path.join("."),
			})),
		},
		{ status: 400 },
	);
}

export function commerceErrorResponse(error: unknown): Response | null {
	if (!(error instanceof CommerceError)) {
		return null;
	}

	const body: {
		code: string;
		error: string;
		issues?: CommerceIssue[];
	} = {
		code: error.code,
		error: error.message,
	};

	if (error.issues?.length) {
		body.issues = error.issues;
	}

	return Response.json(body, { status: error.status });
}
