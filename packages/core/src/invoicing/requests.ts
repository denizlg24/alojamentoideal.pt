import {
	type Database,
	type OrderBillingAddressSnapshot,
	orderContact as orderContactTable,
	order as orderTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { InvoicingError } from "./errors";

export interface InvoiceRequestFiscalDetails {
	billingAddress: OrderBillingAddressSnapshot;
	companyName: string | null;
	isCompany: boolean;
	name: string;
	taxNumber: string;
}

export interface RequestOrderInvoiceInput {
	fiscal: InvoiceRequestFiscalDetails;
	orderId: string;
}

export interface RequestOrderInvoiceResult {
	created: boolean;
	requestedAt: Date;
}

/** Persists the guest's fiscal details and an idempotent operator request. */
export class InvoiceRequestService {
	readonly #db: Database;
	readonly #now: () => Date;

	constructor(options: { db: Database; now?: () => Date }) {
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
	}

	async requestOrderInvoice(
		input: RequestOrderInvoiceInput,
	): Promise<RequestOrderInvoiceResult> {
		const [order] = await this.#db
			.select({
				fulfilledAt: orderTable.invoiceRequestFulfilledAt,
				requestedAt: orderTable.invoiceRequestedAt,
				status: orderTable.status,
			})
			.from(orderTable)
			.where(eq(orderTable.id, input.orderId))
			.limit(1);
		if (!order) {
			throw new InvoicingError("order_not_found", "order not found");
		}
		if (order.status !== "confirmed") {
			throw new InvoicingError(
				"order_not_paid",
				"an invoice can only be requested for a confirmed order",
			);
		}
		if (order.fulfilledAt) {
			throw new InvoicingError(
				"already_invoiced",
				"the invoice for this order has already been issued",
			);
		}

		const now = this.#now();
		await this.#db.transaction(async (tx) => {
			await tx
				.update(orderContactTable)
				.set({
					billingAddress: input.fiscal.billingAddress,
					companyName: input.fiscal.companyName,
					isCompany: input.fiscal.isCompany,
					name: input.fiscal.name,
					taxNumber: input.fiscal.taxNumber,
				})
				.where(eq(orderContactTable.orderId, input.orderId));
			await tx
				.update(orderTable)
				.set({ invoiceRequestedAt: order.requestedAt ?? now, updatedAt: now })
				.where(eq(orderTable.id, input.orderId));
		});

		return {
			created: order.requestedAt === null,
			requestedAt: order.requestedAt ?? now,
		};
	}
}
