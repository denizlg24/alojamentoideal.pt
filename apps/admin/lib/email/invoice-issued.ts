import { escapeHtml, getEmailSender } from "@workspace/auth";
import { getDb, order, orderContact } from "@workspace/db";
import { eq } from "drizzle-orm";

const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

function trustedDocumentUrl(value: string): boolean {
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

// Hostkit responds 403 for a short window after closeInvoice while the PDF is
// still being generated, so failed attempts are retried with backoff.
async function downloadInvoicePdf(documentUrl: string): Promise<Response> {
	let lastStatus = 0;
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(documentUrl, {
			headers: { Accept: "application/pdf" },
			signal: AbortSignal.timeout(15_000),
		}).catch((error: unknown) => {
			if (attempt >= DOWNLOAD_RETRY_DELAYS_MS.length) throw error;
			return null;
		});
		if (response?.ok) return response;
		if (response) lastStatus = response.status;
		if (attempt >= DOWNLOAD_RETRY_DELAYS_MS.length)
			throw new Error(`Invoice PDF download failed with status ${lastStatus}`);
		await new Promise((resolve) =>
			setTimeout(resolve, DOWNLOAD_RETRY_DELAYS_MS[attempt]),
		);
	}
}

export async function sendIssuedInvoiceEmail(input: {
	documentUrl: string;
	invoiceId: string;
	orderReference: string;
}): Promise<void> {
	if (!trustedDocumentUrl(input.documentUrl))
		throw new Error("Hostkit returned an untrusted invoice document URL");
	const [recipient] = await getDb()
		.select({ email: orderContact.email, name: orderContact.name })
		.from(order)
		.innerJoin(orderContact, eq(orderContact.orderId, order.id))
		.where(eq(order.publicReference, input.orderReference.trim().toUpperCase()))
		.limit(1);
	if (!recipient) throw new Error("Invoice recipient was not found");

	const response = await downloadInvoicePdf(input.documentUrl);
	const declaredLength = Number(response.headers.get("content-length") ?? 0);
	if (declaredLength > MAX_INVOICE_BYTES)
		throw new Error("Invoice PDF is too large to attach");
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > MAX_INVOICE_BYTES)
		throw new Error("Invoice PDF is too large to attach");

	const reference = escapeHtml(input.orderReference);
	const name = escapeHtml(recipient.name);
	await getEmailSender().send({
		attachments: [
			{
				content: bytes.toString("base64"),
				filename: `invoice-${input.orderReference}.pdf`,
			},
		],
		html: `<p>Hi ${name},</p><p>Your invoice for order <strong>${reference}</strong> is ready. It is attached to this email and remains available from your order page.</p>`,
		subject: `Your invoice for order ${input.orderReference}`,
		text: `Hi ${recipient.name}, your invoice for order ${input.orderReference} is ready. It is attached to this email and remains available from your order page.`,
		to: recipient.email,
	});
}
