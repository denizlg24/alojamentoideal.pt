import { z } from "zod";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";
import {
	commerceErrorResponse,
	loadAdminOrder,
	orderRefundService,
} from "@/lib/api/commerce";

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
 * Money-only — the order status and provider holds are untouched; cancelling a
 * reservation is a separate action. Repeated refunds accumulate in the
 * `order_refunds` ledger, guarded so the total never exceeds the captured
 * amount.
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
			const result = await orderRefundService().refundOrder({
				actorUserId: admin.id,
				amountMinor: parsed.data.amountMinor,
				note: parsed.data.note ?? null,
				orderId: row.id,
				orderItemId: parsed.data.orderItemId ?? null,
				reason: parsed.data.reason,
			});
			return Response.json({ data: result, success: true });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
