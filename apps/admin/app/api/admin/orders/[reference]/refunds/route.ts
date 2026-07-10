import { z } from "zod";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";
import {
	adminOrderAccess,
	commerceErrorResponse,
	commerceService,
	loadAdminOrder,
	orderRefundService,
} from "@/lib/api/commerce";
import { sendOrderRefundEmail } from "@/lib/email/order-refund";

interface AdminOrderRefundsRouteContext {
	params: Promise<{ reference: string }>;
}

const refundSchema = z.object({
	amountMinor: z.number().int().positive(),
	note: z.string().trim().max(500).optional(),
	orderItemId: z.string().min(1).optional(),
	reason: z
		.enum(["requested_by_customer", "duplicate", "fraudulent", "other"])
		.default("requested_by_customer"),
});

/**
 * Admin-only: issue a manual (partial or full) Stripe refund against an order.
 * When attributed to one item, that reservation is cancelled at its provider
 * before Stripe is called. Repeated refunds accumulate in the `order_refunds`
 * ledger, guarded so the total never exceeds the captured amount.
 */
export const POST = withAdminRoute<AdminOrderRefundsRouteContext>(
	{ name: "admin.orders.refunds.create", rateLimit: { bucket: "mutation" } },
	async (request: Request, context, admin): Promise<Response> => {
		const { reference } = await context.params;
		const parsed = refundSchema.safeParse((await readJson(request)) ?? {});
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Invalid refund request.",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
			const service = await commerceService();
			const detail = await service.readOrderDetail(adminOrderAccess(row));
			const attributedItem = parsed.data.orderItemId
				? (detail.items.find((item) => item.id === parsed.data.orderItemId) ??
					null)
				: null;
			if (parsed.data.orderItemId && !attributedItem) {
				return Response.json(
					{ error: "The attributed reservation is not part of this order." },
					{ status: 422 },
				);
			}
			const result = await orderRefundService().refundOrder({
				actorUserId: admin.id,
				amountMinor: parsed.data.amountMinor,
				note: parsed.data.note ?? null,
				orderId: row.id,
				orderItemId: parsed.data.orderItemId ?? null,
				reason: parsed.data.reason,
			});

			let emailError: string | undefined;
			if (detail.contact) {
				try {
					await sendOrderRefundEmail({
						amountMinor: parsed.data.amountMinor,
						currency: result.refund.currency,
						email: detail.contact.email,
						...(attributedItem ? { itemTitle: attributedItem.title } : {}),
						name: detail.contact.name,
						publicReference: row.publicReference,
					});
				} catch (error) {
					emailError =
						error instanceof Error ? error.message : "Unknown email error";
					console.error("Refund succeeded but guest email failed", {
						error: emailError,
						orderId: row.id,
						refundId: result.refund.id,
					});
				}
			}
			return Response.json({
				data: { ...result, ...(emailError ? { emailError } : {}) },
				success: true,
			});
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
