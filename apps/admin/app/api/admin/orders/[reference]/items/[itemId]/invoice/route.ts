import { z } from "zod";
import { readJson } from "@/lib/api/admin-route";
import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminOrderItemInvoiceRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

const customerSchema = z.object({
	address: z.string().max(200).nullish(),
	city: z.string().max(120).nullish(),
	country: z.string().min(1).max(3),
	name: z.string().min(1).max(200),
	postalCode: z.string().max(20).nullish(),
	taxNumber: z.string().max(40).nullish(),
});

const lineSchema = z.object({
	customDescription: z.string().min(1).max(200),
	discount: z.number().min(0).max(100),
	price: z.string().min(1),
	productId: z.string().min(1).max(40),
	quantity: z.number().positive(),
	reasonCode: z.string().max(10).nullish(),
	type: z.enum(["I", "P", "S"]),
	vat: z.number().min(0).max(100),
});

const createInvoiceSchema = z.object({
	customer: customerSchema.optional(),
	invoiceType: z.enum(["FR", "FT"]).optional(),
	lines: z.array(lineSchema).max(50).optional(),
});

/**
 * Admin-only: issue the Hostkit invoice for one order item. With an edited
 * `customer` + `lines` body it issues the operator-reviewed document (the
 * semi-manual path); with an empty body it falls back to the automatic mapping
 * from the order's own charge rows. Double-gated: admin role plus
 * HOSTKIT_INVOICING_ENABLED. Issuance is an explicit operator action, never a
 * payment hook.
 */
export const POST = withInvoicingAdmin<AdminOrderItemInvoiceRouteContext>(
	{ name: "admin.orders.invoices.create", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { itemId, reference } = await context.params;
		const parsed = createInvoiceSchema.safeParse(
			(await readJson(request)) ?? {},
		);

		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Invalid invoice options.",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const service = invoicingService();
		const { customer, invoiceType, lines } = parsed.data;

		if (customer && lines) {
			const invoice = await service.createOrderItemInvoiceFromLines({
				customer: {
					address: customer.address ?? null,
					city: customer.city ?? null,
					country: customer.country,
					name: customer.name,
					postalCode: customer.postalCode ?? null,
					taxNumber: customer.taxNumber ?? null,
				},
				invoiceType,
				lines: lines.map((line) => ({
					customDescription: line.customDescription,
					discount: line.discount,
					price: line.price,
					productId: line.productId,
					quantity: line.quantity,
					reasonCode: line.reasonCode ?? null,
					type: line.type,
					vat: line.vat,
				})),
				orderItemId: itemId,
				orderReference: reference,
			});
			return Response.json({ data: { invoice }, success: true });
		}

		const invoice = await service.createInvoiceForOrderItem({
			invoiceType,
			orderItemId: itemId,
			orderReference: reference,
		});
		return Response.json({ data: { invoice }, success: true });
	},
);
