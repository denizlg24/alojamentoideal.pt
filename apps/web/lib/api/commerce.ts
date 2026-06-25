import {
	type AccommodationQuoteResult,
	AccommodationQuoteService,
	getAccommodationsConfig,
} from "@workspace/core/accommodations";
import {
	type CartOwner,
	CommerceError,
	type CommerceIssue,
	type CommerceParseResult,
	type CommerceQuoteInput,
	CommerceService,
	HostifyReservationGateway,
	mapStripePaymentStatus,
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
import type { AppliedDiscountSnapshot } from "@workspace/db";
import { CART_COOKIE_NAME, getDb } from "@workspace/db";
import { getServerUser } from "@/lib/auth/session";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";
import { quoteFailure } from "./hostify-errors";

// Matches CART_TTL_MS in the commerce service (~14 days).
const CART_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch (error) {
		console.error("Failed to parse request JSON", error);
		return null;
	}
}

/** Reads the secret cart token from the `ai_cart` cookie, if present. */
export function readCartToken(request: Request): string | null {
	const header = request.headers.get("cookie");
	if (!header) {
		return null;
	}

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) {
			continue;
		}
		const name = part.slice(0, separator).trim();
		if (name === CART_COOKIE_NAME) {
			try {
				return decodeURIComponent(part.slice(separator + 1).trim());
			} catch {
				// Malformed percent-encoding: degrade to anonymous rather than 500.
				return null;
			}
		}
	}

	return null;
}

/**
 * Builds the cart owner context from the authenticated session (if any) and the
 * anonymous cart cookie. The service decides which, if either, grants access.
 */
export async function resolveCartOwner(request: Request): Promise<CartOwner> {
	const user = await getServerUser(request);
	return { cartToken: readCartToken(request), userId: user?.id ?? null };
}

/** Serializes the `Set-Cookie` value persisting the anonymous cart token. */
export function cartCookie(token: string): string {
	const attributes = [
		`${CART_COOKIE_NAME}=${encodeURIComponent(token)}`,
		"Path=/",
		`Max-Age=${CART_COOKIE_MAX_AGE_SECONDS}`,
		"HttpOnly",
		"SameSite=Lax",
	];
	if (process.env.NODE_ENV === "production") {
		attributes.push("Secure");
	}
	return attributes.join("; ");
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
 * Builds a request-scoped CommerceService. Fresh instantiation per call is
 * intentional: the service is stateless and the underlying Hostify, Redis and
 * Postgres clients are themselves pooled/singletons, so this is cheap.
 */
export function commerceService(): CommerceService {
	const config = getAccommodationsConfig();
	const hostifyClient = createHostifyClientFromEnv();
	const stripe = optionalStripeClient();
	const quoteService = new AccommodationQuoteService({
		client: hostifyClient,
		currency: config.currency,
		redis: getRedis(),
		ttlSeconds: config.quoteCacheTtlSeconds,
	});

	return new CommerceService({
		accountId: config.hostifyAccountId,
		// Default on; Finance can switch to manual-hold via env (D4).
		autoRefundOnFailure:
			process.env.COMMERCE_AUTO_REFUND !== "false" && stripe !== null,
		currency: config.currency,
		db: getDb(),
		provider: HOSTIFY_PROVIDER,
		// One full refund per failed order. When Stripe is not configured, leave
		// the hook absent so the saga enters the manual-recovery path.
		refundPayment: stripe
			? (request) => createRefund(stripe, request)
			: undefined,
		// The reservation saga dispatches through a provider-keyed gateway; Hostify
		// is the only provider today (Bokun slots in here later).
		resolveReservationGateway: (provider) =>
			provider === HOSTIFY_PROVIDER
				? new HostifyReservationGateway({ client: hostifyClient })
				: undefined,
		// The reconciler reads live PaymentIntent state when a webhook never arrived.
		retrievePaymentIntent: stripe
			? async (paymentIntentId) => {
					const snapshot = await retrievePaymentIntentSnapshot(
						stripe,
						paymentIntentId,
					);
					return {
						amountMinor: snapshot.amountMinor,
						currency: snapshot.currency,
						status: mapStripePaymentStatus(snapshot.status),
					};
				}
			: undefined,
		quoteAccommodation: async (
			input: CommerceQuoteInput,
		): Promise<AccommodationQuoteResult> => {
			try {
				return await quoteService.quote({
					...input,
					accountId: config.hostifyAccountId,
					// Cart pricing reuses the short-TTL quote the booking widget warmed
					// rather than always re-pricing live; callers opt into a fresh price
					// via `forceFresh`. Availability is still re-checked at the hold.
					forceFresh: input.forceFresh ?? false,
					providerId: HOSTIFY_PROVIDER,
				});
			} catch (error) {
				const failure = quoteFailure(error);
				if (failure) {
					throw new CommerceError(
						failure.code,
						failure.message,
						failure.status,
					);
				}
				throw error;
			}
		},
		quoteTtlSeconds: config.quoteCacheTtlSeconds,
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
	});
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
