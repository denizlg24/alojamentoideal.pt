import { describe, expect, it } from "bun:test";
import {
	buildInvoiceLine,
	chargeVatPercent,
	invoiceableCharges,
	minorToDecimalString,
	resolveInvoiceCustomer,
} from "./invoices";

const BASE_CUSTOMER = {
	billingCity: "Porto",
	billingCountry: "PT",
	billingLine1: "Rua do Exemplo 10",
	billingLine2: null,
	billingPostalCode: "4000-123",
	companyName: null,
	isCompany: false,
	name: "Alana Bolsch",
	taxNumber: null,
};

describe("minorToDecimalString", () => {
	it("formats minor units without floating point drift", () => {
		expect(minorToDecimalString(123456)).toBe("1234.56");
		expect(minorToDecimalString(5)).toBe("0.05");
		expect(minorToDecimalString(0)).toBe("0.00");
		expect(minorToDecimalString(-2050)).toBe("-20.50");
	});

	it("rejects non-integer amounts", () => {
		expect(() => minorToDecimalString(10.5)).toThrow(RangeError);
	});
});

describe("chargeVatPercent", () => {
	it("prefers persisted basis points", () => {
		expect(
			chargeVatPercent({
				feeSubtype: null,
				grossMinor: 10600,
				kind: "accommodation",
				name: "Stay",
				netMinor: 10000,
				taxMinor: 600,
				taxRateBasisPoints: 600,
			}),
		).toBe(6);
	});

	it("derives from amounts when basis points are absent", () => {
		expect(
			chargeVatPercent({
				feeSubtype: "cleaning",
				grossMinor: 12300,
				kind: "fee",
				name: "Cleaning fee",
				netMinor: 10000,
				taxMinor: 2300,
				taxRateBasisPoints: null,
			}),
		).toBe(23);
	});

	it("returns zero for untaxed rows", () => {
		expect(
			chargeVatPercent({
				feeSubtype: null,
				grossMinor: 400,
				kind: "tax",
				name: "City tax",
				netMinor: 400,
				taxMinor: 0,
				taxRateBasisPoints: null,
			}),
		).toBe(0);
	});
});

describe("buildInvoiceLine", () => {
	it("maps accommodation to the certified AL product", () => {
		const line = buildInvoiceLine({
			feeSubtype: null,
			grossMinor: 10600,
			kind: "accommodation",
			name: "4 nights",
			netMinor: 10000,
			taxMinor: 600,
			taxRateBasisPoints: 600,
		});
		expect(line).toEqual({
			customDescription: "4 nights",
			discount: 0,
			price: "100.00",
			productId: "AL",
			quantity: 1,
			reasonCode: undefined,
			type: "S",
			vat: 6,
		});
	});

	it("maps tourist tax rows to TMT with the exemption code", () => {
		const line = buildInvoiceLine({
			feeSubtype: null,
			grossMinor: 800,
			kind: "tax",
			name: "Touristic tax",
			netMinor: 800,
			taxMinor: 0,
			taxRateBasisPoints: null,
		});
		expect(line.productId).toBe("TMT");
		expect(line.type).toBe("I");
		expect(line.reasonCode).toBe("M99");
	});

	it("maps cleaning fees by subtype", () => {
		const line = buildInvoiceLine({
			feeSubtype: "cleaning",
			grossMinor: 4920,
			kind: "fee",
			name: "Taxa de limpeza",
			netMinor: 4000,
			taxMinor: 920,
			taxRateBasisPoints: 2300,
		});
		expect(line.productId).toBe("CF");
		expect(line.vat).toBe(23);
	});

	it("does not classify fees from mutable names", () => {
		const line = buildInvoiceLine({
			feeSubtype: null,
			grossMinor: 4920,
			kind: "fee",
			name: "Short-term cleaning fee",
			netMinor: 4000,
			taxMinor: 920,
			taxRateBasisPoints: 2300,
		});
		expect(line.productId).toBe("EXTRAS");
	});

	it("keeps discount rows negative so the total matches the charge", () => {
		const line = buildInvoiceLine({
			feeSubtype: null,
			grossMinor: -1000,
			kind: "discount",
			name: "Promo code",
			netMinor: -1000,
			taxMinor: 0,
			taxRateBasisPoints: null,
		});
		expect(line.price).toBe("-10.00");
		expect(line.productId).toBe("EXTRAS");
	});
});

describe("invoiceableCharges", () => {
	it("drops zero-value rows", () => {
		const rows = invoiceableCharges([
			{
				feeSubtype: null,
				grossMinor: 0,
				kind: "fee",
				name: "Waived fee",
				netMinor: 0,
				taxMinor: 0,
				taxRateBasisPoints: null,
			},
			{
				feeSubtype: null,
				grossMinor: 100,
				kind: "fee",
				name: "Real fee",
				netMinor: 100,
				taxMinor: 0,
				taxRateBasisPoints: null,
			},
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Real fee");
	});
});

describe("resolveInvoiceCustomer", () => {
	it("resolves a consumer without a tax number to 999999990", () => {
		const result = resolveInvoiceCustomer(BASE_CUSTOMER);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.customer).toEqual({
			address: "Rua do Exemplo 10",
			city: "Porto",
			country: "PRT",
			cp: "4000-123",
			customerId: "999999990",
			name: "Alana Bolsch",
		});
	});

	it("uses the tax number and company name when invoicing a company", () => {
		const result = resolveInvoiceCustomer({
			...BASE_CUSTOMER,
			companyName: "Example Lda",
			isCompany: true,
			taxNumber: "501234567",
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.customer.customerId).toBe("501234567");
		expect(result.customer.name).toBe("Example Lda");
	});

	it("refuses an unresolvable billing country", () => {
		expect(
			resolveInvoiceCustomer({ ...BASE_CUSTOMER, billingCountry: null }).kind,
		).toBe("unresolved_country");
		expect(
			resolveInvoiceCustomer({ ...BASE_CUSTOMER, billingCountry: "ZZ" }).kind,
		).toBe("unresolved_country");
	});
});
