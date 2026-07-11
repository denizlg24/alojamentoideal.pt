import { countryAlpha3 } from "../compliance/country-codes";
import type { HostkitAddInvoiceLineInput } from "../integrations/hostkit";

/**
 * Portuguese invoicing constants. AL is the certified product id for local
 * lodging (Alojamento Local), TMT the municipal tourist tax; both follow the
 * legacy app's Hostkit account setup. `999999990` is the statutory customer
 * id for a final consumer without a VAT number.
 */
export const FINAL_CONSUMER_CUSTOMER_ID = "999999990";
const VAT_EXEMPTION_REASON_CODE = "M99";

export interface InvoiceChargeRow {
	feeSubtype: string | null;
	grossMinor: number;
	kind: string;
	name: string;
	netMinor: number;
	taxMinor: number;
	taxRateBasisPoints: number | null;
}

export interface InvoiceCustomerInput {
	billingCity: string | null;
	billingCountry: string | null;
	billingLine1: string | null;
	billingLine2: string | null;
	billingPostalCode: string | null;
	companyName: string | null;
	isCompany: boolean;
	name: string;
	taxNumber: string | null;
}

export interface ResolvedInvoiceCustomer {
	address?: string;
	city?: string;
	/** ISO alpha-3, as required by Hostkit. */
	country: string;
	cp?: string;
	customerId: string;
	name: string;
}

export type ResolveCustomerResult =
	| { kind: "ok"; customer: ResolvedInvoiceCustomer }
	| { kind: "unresolved_country" };

/**
 * Maps our billing contact snapshot to the Hostkit invoice recipient. The
 * country is mandatory on the fiscal document, so an unmappable billing
 * country blocks issuance instead of guessing.
 */
export function resolveInvoiceCustomer(
	input: InvoiceCustomerInput,
): ResolveCustomerResult {
	const country = countryAlpha3(input.billingCountry);
	if (!country) {
		return { kind: "unresolved_country" };
	}

	const taxNumber = input.taxNumber?.trim() || null;
	const name =
		input.isCompany && input.companyName?.trim()
			? input.companyName.trim()
			: input.name.trim();
	const address = [input.billingLine1?.trim(), input.billingLine2?.trim()]
		.filter((part): part is string => Boolean(part))
		.join(" ");

	return {
		customer: {
			address: address || undefined,
			city: input.billingCity?.trim() || undefined,
			country,
			cp: input.billingPostalCode?.trim() || undefined,
			customerId: taxNumber ?? FINAL_CONSUMER_CUSTOMER_ID,
			name,
		},
		kind: "ok",
	};
}

/**
 * Certified product mapping for order charge rows, mirroring the legacy
 * Hostkit account catalogue: AL for the stay, TMT for tourist tax (an `I`
 * line), CF for cleaning, SAL for service-type fees, EXTRAS otherwise.
 */
function chargeProduct(charge: InvoiceChargeRow): {
	productId: string;
	type: "I" | "P" | "S";
} {
	switch (charge.kind) {
		case "accommodation":
			return { productId: "AL", type: "S" };
		case "tax":
			return { productId: "TMT", type: "I" };
		case "discount":
			return { productId: "EXTRAS", type: "S" };
		default:
			break;
	}

	if (charge.kind === "fee") {
		switch (normalizeFeeSubtype(charge.feeSubtype)) {
			case "cleaning":
			case "cleaning_fee":
				return { productId: "CF", type: "S" };
			case "breakfast":
			case "breakfast_fee":
				return { productId: "PA", type: "P" };
			case "city_tax":
			case "municipal_tax":
			case "tax":
			case "tourist_tax":
			case "touristic_tax":
				return { productId: "TMT", type: "I" };
			case "administrative":
			case "administrative_fee":
			case "booking_fee":
			case "guest_registration":
			case "guest_registration_fee":
			case "hoa":
			case "hoa_fee":
			case "management":
			case "management_fee":
			case "service":
			case "service_fee":
				return { productId: "SAL", type: "S" };
			default:
				break;
		}
	}

	return { productId: "EXTRAS", type: "S" };
}

function normalizeFeeSubtype(value: string | null): string | null {
	const normalized =
		value
			?.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, "_") ?? "";
	return normalized || null;
}

/** Formats a minor-unit amount as the decimal string Hostkit expects. */
export function minorToDecimalString(minor: number): string {
	if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
		throw new RangeError(`amount must be an integer of minor units: ${minor}`);
	}
	const sign = minor < 0 ? "-" : "";
	const absolute = Math.abs(minor);
	const euros = Math.floor(absolute / 100);
	const cents = String(absolute % 100).padStart(2, "0");
	return `${sign}${euros}.${cents}`;
}

/**
 * Whole-percent VAT rate for a charge row: the persisted basis points when
 * present, otherwise derived from the tax/net amounts.
 */
export function chargeVatPercent(charge: InvoiceChargeRow): number {
	if (charge.taxRateBasisPoints !== null) {
		return Math.round(charge.taxRateBasisPoints / 100);
	}
	if (charge.netMinor !== 0 && charge.taxMinor > 0) {
		return Math.round((charge.taxMinor / Math.abs(charge.netMinor)) * 100);
	}
	return 0;
}

export type InvoiceLineDraft = Omit<
	HostkitAddInvoiceLineInput,
	"id" | "invoicingNif" | "series"
>;

/**
 * Maps one order charge row to a Hostkit invoice line. Quantities collapse to
 * 1 with the full net amount as the price so the document total matches the
 * charged total exactly (no per-unit rounding drift). Discount rows become
 * negative lines, keeping the invoice equal to what the customer paid.
 */
export function buildInvoiceLine(charge: InvoiceChargeRow): InvoiceLineDraft {
	const { productId, type } = chargeProduct(charge);
	const vat = chargeVatPercent(charge);
	// Explicit tax rows (for example the municipal tourist tax) are persisted
	// with the whole charge in taxMinor/grossMinor and a zero netMinor. On the
	// fiscal document they are an exempt TMT product, so their unit price is the
	// gross charge. Ordinary VAT-bearing rows continue to use their net amount.
	const lineAmountMinor =
		charge.kind === "tax" ? charge.grossMinor : charge.netMinor;
	return {
		customDescription: charge.name,
		discount: 0,
		price: minorToDecimalString(lineAmountMinor),
		productId,
		quantity: 1,
		reasonCode: vat === 0 ? VAT_EXEMPTION_REASON_CODE : undefined,
		type,
		vat,
	};
}

/** Charge rows worth a line on the document (zero-value rows add noise). */
export function invoiceableCharges(
	charges: readonly InvoiceChargeRow[],
): InvoiceChargeRow[] {
	return charges.filter(
		(charge) => charge.netMinor !== 0 || charge.taxMinor !== 0,
	);
}

/**
 * A fully operator-editable invoice line. Mirrors {@link InvoiceLineDraft} but
 * keeps `price` a string (form input) and `type`/`reasonCode` always present so
 * the semi-manual invoicing form can round-trip a row without losing fields.
 */
export interface EditableInvoiceLine {
	customDescription?: string | null;
	/** Whole-percent line discount. */
	discount: number;
	/** Unit price in euros, decimal string (e.g. "120.00"). */
	price: string;
	productId: string;
	/** Human product label used when no custom line description is provided. */
	productLabel?: string | null;
	quantity: number;
	reasonCode: string | null;
	type: "I" | "P" | "S";
	/** Whole-percent VAT rate. */
	vat: number;
}

/** Operator-editable invoice recipient (country as ISO alpha-2, resolved to alpha-3 on issue). */
export interface InvoiceCustomerDraft {
	address: string | null;
	city: string | null;
	country: string;
	name: string;
	postalCode: string | null;
	/** Portuguese NIF / tax number; empty issues to the final-consumer id. */
	taxNumber: string | null;
}

/** Prefills an editable line from an auto-built charge line. */
export function toEditableInvoiceLine(
	draft: InvoiceLineDraft,
): EditableInvoiceLine {
	return {
		customDescription: draft.customDescription,
		discount: draft.discount,
		price:
			typeof draft.price === "number" ? draft.price.toString() : draft.price,
		productId: draft.productId,
		productLabel: null,
		quantity: draft.quantity,
		reasonCode: draft.reasonCode ?? null,
		type: draft.type ?? "S",
		vat: draft.vat,
	};
}

/**
 * Maps an operator-edited line back to a Hostkit line draft. A zero-VAT line
 * must carry an exemption reason code; we default to M99 when the operator
 * leaves it blank so Hostkit never rejects the line.
 */
export function editableInvoiceLineToDraft(
	line: EditableInvoiceLine,
): InvoiceLineDraft {
	const reason = line.reasonCode?.trim() || null;
	const customDescription =
		line.customDescription?.trim() ||
		line.productLabel?.trim() ||
		line.productId.trim();
	return {
		customDescription,
		discount: line.discount,
		price: line.price,
		productId: line.productId,
		quantity: line.quantity,
		reasonCode:
			line.vat === 0
				? (reason ?? VAT_EXEMPTION_REASON_CODE)
				: (reason ?? undefined),
		type: line.type,
		vat: line.vat,
	};
}

/**
 * Estimated gross total (minor units) of an edited line set, for the local
 * `order_invoices` record. Hostkit remains the authoritative document total;
 * this only drives the admin display.
 */
export function editableInvoiceLinesTotalMinor(
	lines: readonly EditableInvoiceLine[],
): number {
	let total = 0;
	for (const line of lines) {
		const unitMinor = Math.round(Number(line.price) * 100);
		if (!Number.isFinite(unitMinor)) {
			continue;
		}
		const net = Math.round(
			(unitMinor * line.quantity * (100 - line.discount)) / 100,
		);
		total += Math.round((net * (100 + line.vat)) / 100);
	}
	return total;
}

/** Prefills the editable recipient block from the order's billing contact. */
export function buildInvoiceCustomerDraft(
	input: InvoiceCustomerInput,
): InvoiceCustomerDraft {
	const name =
		input.isCompany && input.companyName?.trim()
			? input.companyName.trim()
			: input.name.trim();
	const address = [input.billingLine1?.trim(), input.billingLine2?.trim()]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	return {
		address: address || null,
		city: input.billingCity?.trim() || null,
		country: input.billingCountry?.trim() || "",
		name,
		postalCode: input.billingPostalCode?.trim() || null,
		taxNumber: input.taxNumber?.trim() || null,
	};
}

/**
 * Resolves an operator-edited recipient to the Hostkit customer shape. Like
 * {@link resolveInvoiceCustomer}, an unmappable country blocks issuance rather
 * than guessing.
 */
export function resolveDraftInvoiceCustomer(
	draft: InvoiceCustomerDraft,
): ResolveCustomerResult {
	const country = countryAlpha3(draft.country);
	if (!country) {
		return { kind: "unresolved_country" };
	}
	return {
		customer: {
			address: draft.address?.trim() || undefined,
			city: draft.city?.trim() || undefined,
			country,
			cp: draft.postalCode?.trim() || undefined,
			customerId: draft.taxNumber?.trim() || FINAL_CONSUMER_CUSTOMER_ID,
			name: draft.name.trim(),
		},
		kind: "ok",
	};
}
