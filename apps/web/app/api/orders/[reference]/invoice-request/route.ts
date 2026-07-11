import {
	InvoiceRequestService,
	InvoicingError,
} from "@workspace/core/invoicing";
import { getDb } from "@workspace/db";
import { z } from "zod";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendInvoiceRequestAdminEmail } from "@/lib/email/invoice-request";

interface InvoiceRequestRouteContext {
	params: Promise<{ reference: string }>;
}

const requestSchema = z.object({
	billingAddress: z.object({
		city: z.string().trim().min(1, "City is required").max(120),
		country: z.string().trim().min(2, "Country is required").max(3),
		line1: z.string().trim().min(1, "Address is required").max(200),
		line2: z.string().trim().max(200).optional().default(""),
		postalCode: z.string().trim().min(1, "Postal code is required").max(20),
		region: z.string().trim().max(120).optional().default(""),
	}),
	companyName: z.string().trim().max(200).nullable(),
	isCompany: z.boolean(),
	name: z.string().trim().min(1, "Fiscal name is required").max(200),
	taxNumber: z.string().trim().min(1, "Tax number is required").max(40),
});

export const POST = withApiRoute<InvoiceRequestRouteContext>(
	{ name: "orders.invoice_request", rateLimit: { bucket: "mutation" } },
	async (request, context): Promise<Response> => {
		const { reference } = await context.params;
		const parsed = requestSchema.safeParse(await readJson(request));
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Please check the fiscal details.",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(
				reference,
				await resolveOrderAccessContext(request, reference),
			);
			if (access.role !== "owner") {
				return Response.json({ error: "Not found" }, { status: 404 });
			}
			const result = await new InvoiceRequestService({
				db: getDb(),
			}).requestOrderInvoice({
				fiscal: parsed.data,
				orderId: access.order.id,
			});
			if (result.created) {
				try {
					await sendInvoiceRequestAdminEmail({
						guestName: parsed.data.name,
						orderReference: access.order.publicReference,
					});
				} catch (error) {
					console.error("Failed to send invoice request admin email", error);
				}
			}
			return Response.json({
				data: { requestedAt: result.requestedAt.toISOString() },
				success: true,
			});
		} catch (error) {
			const commerce = commerceErrorResponse(error);
			if (commerce) return commerce;
			if (error instanceof InvoicingError) {
				return Response.json(
					{ code: error.code, error: error.message },
					{ status: error.code === "already_invoiced" ? 409 : 422 },
				);
			}
			throw error;
		}
	},
);
