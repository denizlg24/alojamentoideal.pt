"use server";

import { toMinorUnits } from "@workspace/core/commerce";
import {
	createPromotionCode,
	discountScopeSchema,
	PromotionCodeConflictError,
	promotionCodeInputSchema,
	setPromotionCodeActive,
	setPromotionCodeScope,
} from "@workspace/core/integrations/stripe";
import type { DiscountScope } from "@workspace/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/admin";
import { promotionsStripeClient, storeCurrency } from "@/lib/promotions";
import { endOfDayIn, PROMOTION_TIME_ZONE } from "@/lib/promotions/expiry";

export interface CreatePromotionRequest {
	code: string;
	discountType: "percentage" | "fixed";
	/** `YYYY-MM-DD`; valid through the end of that day in Lisbon. Null never expires. */
	expiresOn: string | null;
	requestId: string;
	scope: DiscountScope;
	/** As typed: a percentage, or an amount in the store currency's major units. */
	value: string;
}

export type CreatePromotionField = "code" | "expiresOn" | "value";

export type CreatePromotionResult =
	| { code: string; ok: true }
	| { error: string; field?: CreatePromotionField; ok: false };

export type PromotionActionResult = { ok: true } | { error: string; ok: false };

const createRequestSchema = z.object({
	code: z.string(),
	discountType: z.enum(["percentage", "fixed"]),
	expiresOn: z.iso.date().nullable(),
	requestId: z.string(),
	scope: discountScopeSchema,
	value: z.string(),
});

const promotionCodeIdSchema = z.string().regex(/^promo_[A-Za-z0-9]+$/);

const STRIPE_UNCONFIGURED = "Stripe is not configured for this environment.";

function fieldForIssue(path: readonly PropertyKey[]): CreatePromotionField {
	if (path[0] === "code") {
		return "code";
	}
	return path[0] === "expiresAt" ? "expiresOn" : "value";
}

function failureMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export async function createPromotionCodeAction(
	request: CreatePromotionRequest,
): Promise<CreatePromotionResult> {
	await requireAdminUser();

	const parsedRequest = createRequestSchema.safeParse(request);
	if (!parsedRequest.success) {
		return {
			error: "The form could not be read. Reload and retry.",
			ok: false,
		};
	}
	const { code, discountType, expiresOn, requestId, scope, value } =
		parsedRequest.data;

	const stripe = promotionsStripeClient();
	if (!stripe) {
		return { error: STRIPE_UNCONFIGURED, ok: false };
	}

	const amount = Number(value.trim().replace(",", "."));
	if (!value.trim() || !Number.isFinite(amount)) {
		return { error: "Enter a number.", field: "value", ok: false };
	}

	const expiresAt = expiresOn
		? endOfDayIn(expiresOn, PROMOTION_TIME_ZONE)
		: null;
	if (expiresAt && expiresAt.getTime() <= Date.now()) {
		return {
			error: "Pick today or a later date.",
			field: "expiresOn",
			ok: false,
		};
	}

	const currency = await storeCurrency();
	const input = promotionCodeInputSchema.safeParse({
		code,
		discount:
			discountType === "percentage"
				? { percentOff: amount, type: "percentage" }
				: { amountMinor: toMinorUnits(amount, currency), type: "fixed" },
		expiresAt,
		requestId,
		scope,
	});
	if (!input.success) {
		const issue = input.error.issues[0];
		return {
			error: issue?.message ?? "Check the highlighted field.",
			field: issue ? fieldForIssue(issue.path) : undefined,
			ok: false,
		};
	}

	try {
		const created = await createPromotionCode(stripe, input.data, { currency });
		revalidatePath("/promotions");
		return { code: created.code, ok: true };
	} catch (error) {
		if (error instanceof PromotionCodeConflictError) {
			return {
				error: "An active code with this name already exists.",
				field: "code",
				ok: false,
			};
		}
		console.error("Failed to create promotion code", error);
		return {
			error: failureMessage(error, "Stripe could not create the code."),
			ok: false,
		};
	}
}

export async function updatePromotionScopeAction(
	promotionCodeId: string,
	scope: DiscountScope,
): Promise<PromotionActionResult> {
	await requireAdminUser();

	const id = promotionCodeIdSchema.safeParse(promotionCodeId);
	const parsedScope = discountScopeSchema.safeParse(scope);
	if (!id.success || !parsedScope.success) {
		return { error: "Unknown promotion code or scope.", ok: false };
	}

	const stripe = promotionsStripeClient();
	if (!stripe) {
		return { error: STRIPE_UNCONFIGURED, ok: false };
	}

	try {
		await setPromotionCodeScope(stripe, id.data, parsedScope.data);
	} catch (error) {
		console.error("Failed to update promotion code scope", error);
		return {
			error: failureMessage(error, "Stripe could not update the code."),
			ok: false,
		};
	}

	revalidatePath("/promotions");
	return { ok: true };
}

export async function setPromotionActiveAction(
	promotionCodeId: string,
	active: boolean,
): Promise<PromotionActionResult> {
	await requireAdminUser();

	const id = promotionCodeIdSchema.safeParse(promotionCodeId);
	if (!id.success || typeof active !== "boolean") {
		return { error: "Unknown promotion code.", ok: false };
	}

	const stripe = promotionsStripeClient();
	if (!stripe) {
		return { error: STRIPE_UNCONFIGURED, ok: false };
	}

	try {
		await setPromotionCodeActive(stripe, id.data, active);
	} catch (error) {
		console.error("Failed to toggle promotion code", error);
		return {
			error: failureMessage(error, "Stripe could not update the code."),
			ok: false,
		};
	}

	revalidatePath("/promotions");
	return { ok: true };
}
