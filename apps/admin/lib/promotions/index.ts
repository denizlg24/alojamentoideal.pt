import "server-only";

import { getAccommodationsConfigFromSettings } from "@workspace/core/accommodations";
import {
	createStripeClientFromEnv,
	listPromotionCodes,
	type PromotionCodeSummary,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { getRuntimeSettings } from "@workspace/core/settings";
import { getDb, order } from "@workspace/db";
import { and, gt, isNotNull, sql } from "@workspace/db/query";

type StripeClient = ReturnType<typeof createStripeClientFromEnv>;

export function promotionsStripeClient(): StripeClient | null {
	try {
		return createStripeClientFromEnv();
	} catch (error) {
		if (error instanceof StripeConfigurationError) {
			return null;
		}
		throw error;
	}
}

/** Checkout currency; fixed-amount codes only apply when they match it. */
export async function storeCurrency(): Promise<string> {
	const config = await getAccommodationsConfigFromSettings(
		await getRuntimeSettings(),
	);
	return config.currency.toUpperCase();
}

export interface AdminPromotionCode extends PromotionCodeSummary {
	/** Paid orders that used the code. Stripe never sees these redemptions. */
	paidOrderCount: number;
}

export type AdminPromotionCodeList =
	| { codes: AdminPromotionCode[]; currency: string; status: "ok" }
	| { status: "stripe_unconfigured" }
	| { message: string; status: "stripe_error" };

function usageKey(couponId: string | null, code: string): string {
	return `${couponId ?? ""}:${code.toUpperCase()}`;
}

async function paidOrderCounts(): Promise<Map<string, number>> {
	const couponId = sql<string | null>`${order.appliedDiscount}->>'couponId'`;
	const code = sql<string>`upper(${order.appliedDiscount}->>'promotionCode')`;
	const rows = await getDb()
		.select({
			code,
			couponId,
			uses: sql<number>`count(*)`.mapWith(Number),
		})
		.from(order)
		.where(and(isNotNull(order.appliedDiscount), gt(order.amountPaidMinor, 0)))
		.groupBy(couponId, code);

	return new Map(
		rows
			.filter((row) => row.code)
			.map((row) => [usageKey(row.couponId, row.code), row.uses]),
	);
}

export async function listAdminPromotionCodes(): Promise<AdminPromotionCodeList> {
	const stripe = promotionsStripeClient();
	if (!stripe) {
		return { status: "stripe_unconfigured" };
	}

	try {
		const [codes, counts, currency] = await Promise.all([
			listPromotionCodes(stripe),
			paidOrderCounts(),
			storeCurrency(),
		]);
		return {
			codes: codes.map((code) => ({
				...code,
				paidOrderCount: counts.get(usageKey(code.couponId, code.code)) ?? 0,
			})),
			currency,
			status: "ok",
		};
	} catch (error) {
		console.error("Failed to load promotion codes", error);
		return {
			message:
				error instanceof Error ? error.message : "Stripe request failed.",
			status: "stripe_error",
		};
	}
}
