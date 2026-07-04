export type HostkitFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface HostkitRequestContext {
	signal?: AbortSignal;
}

export interface HostkitClientOptions {
	/** Property-scoped Hostkit API key (one key per property). */
	apiKey: string;
	baseUrl?: string;
	fetch?: HostkitFetch;
	maxReadRetries?: number;
	retryDelayMs?: number;
	timeoutMs?: number;
	/** Optional Hostkit account uid forwarded on every call when set. */
	uid?: string;
}

/** Hostkit document types: P = passport, ID = national id card, O = other. */
export type HostkitGuestDocumentType = "ID" | "O" | "P";

export interface HostkitAddGuestInput {
	/** Check-in date, YYYY-MM-DD. */
	arrival: string;
	/** Birth date, YYYY-MM-DD. */
	birthday: string;
	/** Residence city name, or "-" when unknown (Hostkit convention). */
	cityResidence?: string;
	/** ISO 3166-1 alpha-3 residence country. */
	countryResidence: string;
	/** Check-out date, YYYY-MM-DD. */
	departure: string;
	/** ISO 3166-1 alpha-3 document issuing country. */
	documentCountry: string;
	/** Document number, max 16 chars. */
	documentId: string;
	documentType: HostkitGuestDocumentType;
	/** Max 40 chars. */
	firstName: string;
	/** Max 40 chars. */
	lastName: string;
	/** ISO 3166-1 alpha-3 nationality. */
	nationality: string;
	/** Provider reservation code (Hostify confirmation code). */
	rcode: string;
}

export interface HostkitReservationCodeInput {
	rcode: string;
}

export interface HostkitRemoveGuestInput {
	/** Guest first or last name, as accepted by Hostkit. */
	name: string;
	rcode: string;
}

export interface HostkitAddInvoiceInput {
	/** Recipient street address. */
	address?: string;
	/** Recipient city. */
	city?: string;
	/** Free-text invoice comment. */
	comment?: string;
	/** Recipient ZIP / postal code. */
	cp?: string;
	/** ISO 3166-1 alpha-3 recipient country. */
	country: string;
	/**
	 * Guest VAT number or document number; 999999990 for a final consumer
	 * without a tax id (Portuguese invoicing convention).
	 */
	customerId: string;
	/** FR = Fatura-Recibo (invoice-receipt), FT = Fatura (invoice). */
	invoiceType?: "FR" | "FT";
	/** Issuing VAT id; defaults to the property's invoicing account. */
	invoicingNif?: string;
	/** Recipient full name. */
	name: string;
	/** Hostkit payment method code (e.g. CC = credit card, TB = transfer). */
	paymentMethod?: string;
	/** Provider reservation code to attach the invoice to. */
	rcode?: string;
	/** Invoice series; defaults to the property's default series. */
	series?: string;
}

export interface HostkitAddInvoiceLineInput {
	/** Human description printed on the line. */
	customDescription: string;
	/** Whole-percent discount for the line. */
	discount: number;
	/** Draft invoice id returned by addInvoice. */
	id: string;
	invoicingNif?: string;
	/** Hostkit product id; created on the fly when it does not exist. */
	productId: string;
	/** Line unit price in euros, decimal string or number (e.g. 1234.56). */
	price: number | string;
	quantity: number;
	/** VAT exemption reason code, required when vat is 0 (e.g. M99). */
	reasonCode?: string;
	/** Line product region, defaults to PT on Hostkit's side. */
	region?: string;
	series?: string;
	/** Line product type (S = service, P = product, I = tax), defaults to S. */
	type?: "I" | "P" | "S";
	/** Whole-percent VAT rate (e.g. 6, 23). */
	vat: number;
}

export interface HostkitInvoiceIdInput {
	/** Draft invoice id returned by addInvoice. */
	id: string;
	invoiceType?: "FR" | "FT";
	invoicingNif?: string;
	series?: string;
}

export interface HostkitAddCreditNoteInput {
	invoiceType?: "FR" | "FT";
	invoicingNif?: string;
	/** Id of the existing closed invoice being credited. */
	refId: string;
	/** Series of the existing closed invoice being credited. */
	refSeries: string;
}

export interface HostkitReservationInvoicesQuery {
	invoicingNif?: string;
	rcode: string;
}

export interface HostkitCreditNotesQuery {
	invoicingNif?: string;
	series: string;
}
