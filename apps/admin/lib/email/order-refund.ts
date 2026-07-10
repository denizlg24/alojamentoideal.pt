import { buildOrderRefundEmail, getEmailSender } from "@workspace/auth";

function formatAmount(amountMinor: number, currency: string): string {
	const formatter = new Intl.NumberFormat("en", {
		currency,
		style: "currency",
	});
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
	return formatter.format(amountMinor / 10 ** fractionDigits);
}

export interface SendOrderRefundEmailInput {
	amountMinor: number;
	currency: string;
	email: string;
	itemTitle?: string;
	name: string;
	publicReference: string;
}

export async function sendOrderRefundEmail(
	input: SendOrderRefundEmailInput,
): Promise<void> {
	await getEmailSender().send({
		to: input.email,
		...buildOrderRefundEmail({
			amount: formatAmount(input.amountMinor, input.currency),
			greeting: input.name ? `Hi ${input.name},` : "Hi there,",
			...(input.itemTitle ? { itemTitle: input.itemTitle } : {}),
			orderNumber: input.publicReference,
		}),
	});
}
