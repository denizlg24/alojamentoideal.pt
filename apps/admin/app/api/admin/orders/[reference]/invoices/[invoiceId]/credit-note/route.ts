import { z } from "zod";
import { readJson } from "@/lib/api/admin-route";
import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";
import { sendIssuedInvoiceEmail } from "@/lib/email/invoice-issued";

interface AdminCreditNoteRouteContext {
	params: Promise<{ invoiceId: string; reference: string }>;
}

/**
 * Admin-only: issue a Hostkit credit note voiding a previously issued
 * invoice. Same double gate as invoice creation.
 */
export const POST = withInvoicingAdmin<AdminCreditNoteRouteContext>(
	{
		name: "admin.orders.invoices.credit_note",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { invoiceId, reference } = await context.params;
		const parsed = z
			.object({ creditAmountMinor: z.number().int().positive().optional() })
			.safeParse((await readJson(request)) ?? {});
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Credit amount must be a positive whole number of cents.",
				},
				{ status: 400 },
			);
		}
		const service = invoicingService();
		if (parsed.data.creditAmountMinor) {
			const result = await service.createPartialCreditNote({
				creditAmountMinor: parsed.data.creditAmountMinor,
				invoiceId,
				orderReference: reference,
			});
			if (result.replacementInvoice.documentUrl) {
				try {
					await sendIssuedInvoiceEmail({
						documentUrl: result.replacementInvoice.documentUrl,
						invoiceId: result.replacementInvoice.id,
						orderReference: reference,
					});
				} catch (error) {
					console.error(
						"Replacement invoice issued but guest email delivery failed",
						error,
					);
				}
			}
			return Response.json({ data: result, success: true });
		}

		const creditNote = await service.createCreditNote({
			invoiceId,
			orderReference: reference,
		});

		return Response.json({ data: { creditNote }, success: true });
	},
);
