import "server-only";

import { getDb, orderInvoice } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export function isTrustedInvoiceDocumentUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			(url.hostname === "hostk.it" ||
				url.hostname === "hostkit.pt" ||
				url.hostname.endsWith(".hostkit.pt"))
		);
	} catch {
		return false;
	}
}

export async function findIssuedInvoiceDocument(
	orderId: string,
	invoiceId: string,
) {
	const [invoice] = await getDb()
		.select({ documentUrl: orderInvoice.documentUrl, kind: orderInvoice.kind })
		.from(orderInvoice)
		.where(
			and(
				eq(orderInvoice.id, invoiceId),
				eq(orderInvoice.orderId, orderId),
				inArray(orderInvoice.status, ["credited", "issued"]),
			),
		)
		.limit(1);
	if (
		!invoice?.documentUrl ||
		!isTrustedInvoiceDocumentUrl(invoice.documentUrl)
	) {
		return null;
	}
	return { documentUrl: invoice.documentUrl, kind: invoice.kind };
}
