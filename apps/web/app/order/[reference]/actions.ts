"use server";

import { CommerceError } from "@workspace/core/commerce";
import { redirect } from "next/navigation";
import { commerceService, setOrderMemberCookie } from "@/lib/api/commerce";
import { getCurrentUser } from "@/lib/auth/session";
import { buildOrderPath } from "@/lib/order/api-client";

export type RedeemOrderAccessResult = {
	ok: false;
	reason: "full" | "invalid";
};

/**
 * Redeems a booking-access magic link from the order hub. A Server Component
 * cannot set the httpOnly member cookie during render, so the hub hands the raw
 * `?token` to this action: it flips the member to `active`, binds the signed-in
 * account when present, writes the order-scoped cookie, then redirects to the
 * clean URL so the token never lingers in history. Only failures return.
 */
export async function redeemOrderAccess(
	reference: string,
	token: string,
): Promise<RedeemOrderAccessResult> {
	const user = await getCurrentUser();
	try {
		await (await commerceService()).redeemMemberToken(reference, token, {
			userId: user?.id ?? null,
		});
	} catch (error) {
		const reason =
			error instanceof CommerceError && error.code === "order_full"
				? "full"
				: "invalid";
		return { ok: false, reason };
	}

	await setOrderMemberCookie(reference, token);
	redirect(buildOrderPath(reference));
}
