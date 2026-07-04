import { describe, expect, it } from "bun:test";
import {
	buildInvoiceCustomerDraft,
	buildInvoiceLine,
	chargeVatPercent,
	type EditableInvoiceLine,
	editableInvoiceLinesTotalMinor,
	editableInvoiceLineToDraft,
	invoiceableCharges,
	minorToDecimalString,
	resolveDraftInvoiceCustomer,
	resolveInvoiceCustomer,
	toEditableInvoiceLine,
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

const EDITABLE_LINE: EditableInvoiceLine = {
	customDescription: "Stay",
	discount: 0,
	price: "100.00",
	productId: "AL",
	quantity: 3,
	reasonCode: null,
	type: "S",
	vat: 6,
};

describe("editableInvoiceLineToDraft", () => {
	it("defaults a zero-VAT line's exemption reason to M99", () => {
		const draft = editableInvoiceLineToDraft({
			...EDITABLE_LINE,
			reasonCode: null,
			vat: 0,
		});
		expect(draft.reasonCode).toBe("M99");
	});

	it("keeps an explicit reason code and omits it for taxed lines", () => {
		expect(
			editableInvoiceLineToDraft({
				...EDITABLE_LINE,
				reasonCode: "M10",
				vat: 0,
			}).reasonCode,
		).toBe("M10");
		expect(
			editableInvoiceLineToDraft(EDITABLE_LINE).reasonCode,
		).toBeUndefined();
	});
});

describe("editableInvoiceLinesTotalMinor", () => {
	it("sums gross line totals with quantity, discount and VAT", () => {
		// 3 * 100.00 = 300.00 net, +6% VAT = 318.00
		expect(editableInvoiceLinesTotalMinor([EDITABLE_LINE])).toBe(31800);
	});

	it("applies a whole-percent line discount before VAT", () => {
		// 1 * 100.00 net, 10% discount -> 90.00, +23% VAT = 110.70
		expect(
			editableInvoiceLinesTotalMinor([
				{
					...EDITABLE_LINE,
					discount: 10,
					quantity: 1,
					vat: 23,
				},
			]),
		).toBe(11070);
	});

	it("ignores lines with a non-numeric price", () => {
		expect(
			editableInvoiceLinesTotalMinor([{ ...EDITABLE_LINE, price: "abc" }]),
		).toBe(0);
	});
});

describe("toEditableInvoiceLine", () => {
	it("round-trips an auto-built charge line, keeping price a string", () => {
		const line = toEditableInvoiceLine(
			buildInvoiceLine({
				feeSubtype: null,
				grossMinor: 10600,
				kind: "accommodation",
				name: "Stay",
				netMinor: 10000,
				taxMinor: 600,
				taxRateBasisPoints: 600,
			}),
		);
		expect(line.price).toBe("100.00");
		expect(line.type).toBe("S");
		expect(line.vat).toBe(6);
		expect(line.quantity).toBe(1);
	});
});

describe("buildInvoiceCustomerDraft", () => {
	it("prefills the editable recipient from the billing contact", () => {
		const draft = buildInvoiceCustomerDraft(BASE_CUSTOMER);
		expect(draft.name).toBe("Alana Bolsch");
		expect(draft.country).toBe("PT");
		expect(draft.city).toBe("Porto");
		expect(draft.address).toBe("Rua do Exemplo 10");
		expect(draft.taxNumber).toBeNull();
	});

	it("prefers the company name for company contacts", () => {
		expect(
			buildInvoiceCustomerDraft({
				...BASE_CUSTOMER,
				companyName: "Ocean Lda",
				isCompany: true,
			}).name,
		).toBe("Ocean Lda");
	});
});

describe("resolveDraftInvoiceCustomer", () => {
	it("resolves country to alpha-3 and falls back to the final-consumer id", () => {
		const result = resolveDraftInvoiceCustomer(
			buildInvoiceCustomerDraft(BASE_CUSTOMER),
		);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.customer.country).toBe("PRT");
			expect(result.customer.customerId).toBe("999999990");
		}
	});

	it("uses the tax number as the customer id when present", () => {
		const result = resolveDraftInvoiceCustomer({
			...buildInvoiceCustomerDraft(BASE_CUSTOMER),
			taxNumber: "501234567",
		});
		expect(result.kind === "ok" && result.customer.customerId).toBe(
			"501234567",
		);
	});

	it("blocks an unmappable country", () => {
		expect(
			resolveDraftInvoiceCustomer({
				...buildInvoiceCustomerDraft(BASE_CUSTOMER),
				country: "",
			}).kind,
		).toBe("unresolved_country");
	});
});
