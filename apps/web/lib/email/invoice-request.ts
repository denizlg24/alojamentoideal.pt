import { escapeHtml, getEmailSender } from "@workspace/auth";

export async function sendInvoiceRequestAdminEmail(input: {
	guestName: string;
	orderReference: string;
}): Promise<void> {
	const recipient = process.env.ROOT_ADMIN_EMAIL?.trim();
	if (!recipient) {
		console.warn(
			"Invoice request saved but ROOT_ADMIN_EMAIL is not configured",
		);
		return;
	}
	const reference = escapeHtml(input.orderReference);
	const guestName = escapeHtml(input.guestName);
	await getEmailSender().send({
		html: `<p>A guest requested an invoice.</p><p><strong>Order:</strong> ${reference}<br><strong>Guest:</strong> ${guestName}</p><p>Open the order in the admin dashboard to review the fiscal details and issue the document.</p>`,
		subject: `Invoice requested for order ${input.orderReference}`,
		text: `A guest requested an invoice for order ${input.orderReference}. Guest: ${input.guestName}. Open the admin dashboard to review the fiscal details and issue it.`,
		to: recipient,
	});
}
