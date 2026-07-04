import { withAdminRoute } from "@/lib/api/admin-route";
import { deleteAdminOrder, loadAdminOrder } from "@/lib/api/commerce";

interface AdminOrderDeleteRouteContext {
	params: Promise<{ reference: string }>;
}

export const POST = withAdminRoute<AdminOrderDeleteRouteContext>(
	{ name: "admin.orders.delete", rateLimit: { bucket: "mutation" } },
	async (_request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		if (row.status === "pending" || row.status === "confirmed") {
			return Response.json(
				{ error: "Cancel or refund this order before deleting it." },
				{ status: 409 },
			);
		}

		if (row.amountPaidMinor > row.amountRefundedMinor) {
			return Response.json(
				{ error: "Orders with unrefunded payments cannot be deleted." },
				{ status: 409 },
			);
		}

		const deleted = await deleteAdminOrder(row);
		if (!deleted) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		return Response.json({
			data: { outcome: "deleted" },
			success: true,
		});
	},
);
