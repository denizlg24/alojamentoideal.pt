import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { findIssuedInvoiceDocument } from "@/lib/order/invoice";

interface InvoiceDocumentRouteContext {
	params: Promise<{ invoiceId: string; reference: string }>;
}

export const GET = withApiRoute<InvoiceDocumentRouteContext>(
	{ name: "orders.invoice_document", rateLimit: { bucket: "cart.read" } },
	async (request, context): Promise<Response> => {
		const { invoiceId, reference } = await context.params;
		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(
				reference,
				await resolveOrderAccessContext(request, reference),
			);
			if (access.role !== "owner") {
				return Response.json({ error: "Not found" }, { status: 404 });
			}
			const invoice = await findIssuedInvoiceDocument(
				access.order.id,
				invoiceId,
			);
			if (!invoice) {
				return Response.json({ error: "Not found" }, { status: 404 });
			}
			// Response.redirect() headers are immutable, which breaks the
			// header decoration in withApiRoute.
			return new Response(null, {
				headers: { location: invoice.documentUrl },
				status: 302,
			});
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) return handled;
			throw error;
		}
	},
);
