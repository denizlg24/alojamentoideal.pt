export type InvoicingErrorCode =
	| "already_invoiced"
	| "billing_contact_missing"
	| "credit_note_target_invalid"
	| "currency_unsupported"
	| "customer_country_unresolved"
	| "hostkit_not_configured"
	| "invoice_not_found"
	| "order_item_not_found"
	| "order_not_found"
	| "order_not_paid"
	| "property_unconfigured"
	| "provider_closed_but_persistence_failed"
	| "provider_error"
	| "reservation_code_unavailable";

/**
 * Domain error for fiscal-document operations. Messages are operator-facing
 * and must stay free of guest PII and provider API keys.
 */
export class InvoicingError extends Error {
	readonly code: InvoicingErrorCode;

	constructor(code: InvoicingErrorCode, message: string) {
		super(message);
		this.name = "InvoicingError";
		this.code = code;
	}
}
