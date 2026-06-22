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
} from "@workspace/core/commerce";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { getRedis } from "@workspace/core/redis";
import { getDb } from "@workspace/db";
import { getServerUser } from "@/lib/auth/session";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";
import { quoteFailure } from "./hostify-errors";

/** httpOnly cookie carrying the secret cart token for anonymous ownership. */
export const CART_COOKIE_NAME = "ai_cart";
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
			return decodeURIComponent(part.slice(separator + 1).trim());
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

export function commerceService(): CommerceService {
	const config = getAccommodationsConfig();
	const quoteService = new AccommodationQuoteService({
		client: createHostifyClientFromEnv(),
		currency: config.currency,
		redis: getRedis(),
		ttlSeconds: config.quoteCacheTtlSeconds,
	});

	return new CommerceService({
		accountId: config.hostifyAccountId,
		currency: config.currency,
		db: getDb(),
		provider: HOSTIFY_PROVIDER,
		quoteAccommodation: async (
			input: CommerceQuoteInput,
		): Promise<AccommodationQuoteResult> => {
			try {
				return await quoteService.quote({
					...input,
					accountId: config.hostifyAccountId,
					forceFresh: true,
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
