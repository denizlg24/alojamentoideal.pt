import {
	type AccommodationQuoteResult,
	AccommodationQuoteService,
	getAccommodationsConfig,
} from "@workspace/core/accommodations";
import {
	CommerceError,
	type CommerceIssue,
	type CommerceParseResult,
	type CommerceQuoteInput,
	CommerceService,
} from "@workspace/core/commerce";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { getRedis } from "@workspace/core/redis";
import { getDb } from "@workspace/db";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";
import { quoteFailure } from "./hostify-errors";

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch (error) {
		console.error("Failed to parse request JSON", error);
		return null;
	}
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
