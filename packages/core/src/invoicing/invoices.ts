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

	const name = charge.name.toLowerCase();
	if (name.includes("cleaning")) {
		return { productId: "CF", type: "S" };
	}
	if (name.includes("breakfast")) {
		return { productId: "PA", type: "P" };
	}
	if (name.includes("touristic tax") || name.includes("tourist tax")) {
		return { productId: "TMT", type: "I" };
	}
	if (
		name.includes("management") ||
		name.includes("administrative") ||
		name.includes("guest registration") ||
		name.includes("hoa") ||
		name.includes("booking fee")
	) {
		return { productId: "SAL", type: "S" };
	}
	return { productId: "EXTRAS", type: "S" };
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
	return {
		customDescription: charge.name,
		discount: 0,
		price: minorToDecimalString(charge.netMinor),
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
