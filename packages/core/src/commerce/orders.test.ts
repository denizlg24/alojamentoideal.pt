import { describe, expect, test } from "bun:test";
import { buildDraftOrderRows, generatePublicOrderReference } from "./orders";
import type {
	DraftOrderContactInput,
	ListingDisplaySnapshot,
	NormalizedAccommodationQuoteSnapshot,
} from "./types";

describe("buildDraftOrderRows", () => {
	test("maps a cart accommodation item to draft order rows", () => {
		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 2,
				quote: quoteSnapshot(),
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.item.sourceCartItemId).toBe("item_1");
		expect(rows.item.position).toBe(2);
		expect(rows.item.totalMinor).toBe(10_600);
		expect(rows.detail.hostifyListingId).toBe("123");
		expect(rows.detail.propertyTimezone).toBe("Europe/Lisbon");
		expect(rows.charges[0]).toMatchObject({
			kind: "accommodation",
			grossMinor: 10_000,
			name: "Accommodation",
		});
		expect(rows.charges[1]).toMatchObject({
			kind: "tax",
			taxMinor: 600,
		});
	});

	test("nets inclusive tax out of non-tax charge lines", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: 12_100,
				chargeLabel: "Stay",
				inclusiveTaxMinor: 2100,
				isBasePrice: true,
				name: "Accommodation",
				providerPayload: null,
				quantity: 1,
				totalMinor: 12_100,
				type: "accommodation",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.charges[0]).toMatchObject({
			grossMinor: 12_100,
			netMinor: 10_000,
			taxMinor: 2100,
			unitNetMinor: 10_000,
		});
	});

	test("maps discount fee lines to discount charges", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: -1000,
				chargeLabel: "Promotion",
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Direct booking discount",
				providerPayload: null,
				quantity: 1,
				totalMinor: -1000,
				type: "discount",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.charges[0]).toMatchObject({
			grossMinor: -1000,
			kind: "discount",
			name: "Direct booking discount",
			netMinor: -1000,
			taxMinor: 0,
			unitNetMinor: -1000,
		});
	});

	test("formats quantity variations for unit net amounts", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Zero quantity fee",
				providerPayload: null,
				quantity: 0,
				totalMinor: 500,
				type: "fee",
			},
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Default quantity fee",
				providerPayload: null,
				quantity: null,
				totalMinor: 300,
				type: "fee",
			},
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Fractional quantity fee",
				providerPayload: null,
				quantity: 2.5,
				totalMinor: 1000,
				type: "fee",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(
			rows.charges.map((charge) => ({
				quantity: charge.quantity,
				unitNetMinor: charge.unitNetMinor,
			})),
		).toEqual([
			{ quantity: "0.00", unitNetMinor: 500 },
			{ quantity: "1.00", unitNetMinor: 300 },
			{ quantity: "2.50", unitNetMinor: 400 },
		]);
	});

	test("maps pure tax fee lines to tax charges", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: 250,
				chargeLabel: "Per guest",
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Tourist tax",
				providerPayload: null,
				quantity: 3,
				totalMinor: 750,
				type: "tax",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.charges[0]).toMatchObject({
			grossMinor: 750,
			kind: "tax",
			netMinor: 0,
			taxMinor: 750,
			unitNetMinor: 0,
		});
	});

	test("treats tax type as tax when inclusive tax is also present", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: 900,
				chargeLabel: "Tax",
				inclusiveTaxMinor: 123,
				isBasePrice: false,
				name: "Municipal tax",
				providerPayload: null,
				quantity: 1,
				totalMinor: 900,
				type: "tax",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.charges[0]).toMatchObject({
			kind: "tax",
			netMinor: 0,
			taxMinor: 900,
		});
	});

	test("keeps repeated fee lines as separate ordered charges", () => {
		const quote = quoteSnapshot();
		quote.feeLines = [
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Cleaning",
				providerPayload: null,
				quantity: null,
				totalMinor: 3000,
				type: "fee",
			},
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Linen",
				providerPayload: null,
				quantity: null,
				totalMinor: 1500,
				type: "fee",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.charges.map((charge) => charge.position)).toEqual([1, 2]);
		expect(rows.charges.map((charge) => charge.kind)).toEqual(["fee", "fee"]);
	});

	test("preserves large monetary values", () => {
		const quote = quoteSnapshot();
		quote.totalMinor = 9_999_999_999;
		quote.subtotalMinor = 9_999_999_999;
		quote.feeLines = [
			{
				amountMinor: null,
				chargeLabel: null,
				inclusiveTaxMinor: null,
				isBasePrice: true,
				name: "Accommodation",
				providerPayload: null,
				quantity: 1,
				totalMinor: 9_999_999_999,
				type: "accommodation",
			},
		];

		const rows = buildDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 1,
				quote,
				snapshot: listingSnapshot(),
			},
			contact(),
		);

		expect(rows.item.totalMinor).toBe(9_999_999_999);
		expect(rows.charges[0]?.grossMinor).toBe(9_999_999_999);
	});
});

describe("generatePublicOrderReference", () => {
	test("formats as AI-{year}-{8 uppercase hex}", () => {
		const reference = generatePublicOrderReference(
			new Date("2026-06-22T12:00:00.000Z"),
		);
		expect(reference).toMatch(/^AI-2026-[0-9A-F]{8}$/);
	});

	test("derives the year from the supplied UTC date", () => {
		const reference = generatePublicOrderReference(
			new Date("2030-01-01T00:00:00.000Z"),
		);
		expect(reference.startsWith("AI-2030-")).toBe(true);
	});

	test("produces a distinct suffix on each call", () => {
		const now = new Date("2026-06-22T12:00:00.000Z");
		const references = new Set(
			Array.from({ length: 100 }, () => generatePublicOrderReference(now)),
		);
		expect(references.size).toBe(100);
	});
});

function quoteSnapshot(): NormalizedAccommodationQuoteSnapshot {
	return {
		adults: 2,
		checkIn: "2026-07-01",
		checkOut: "2026-07-03",
		children: 1,
		cleaningFeeMinor: null,
		currency: "EUR",
		expiresAt: new Date("2026-06-22T12:05:00.000Z"),
		externalAccountId: "acct_1",
		feeLines: [
			{
				amountMinor: null,
				chargeLabel: "Stay",
				inclusiveTaxMinor: null,
				isBasePrice: true,
				name: "Accommodation",
				providerPayload: null,
				quantity: 2,
				totalMinor: 10_000,
				type: "accommodation",
			},
			{
				amountMinor: 200,
				chargeLabel: "Per guest",
				inclusiveTaxMinor: null,
				isBasePrice: false,
				name: "Tourist tax",
				providerPayload: null,
				quantity: 3,
				totalMinor: 600,
				type: "tax",
			},
		],
		fetchedAt: new Date("2026-06-22T12:00:00.000Z"),
		guests: 3,
		housingFeeMinor: 10_000,
		id: "quote_1",
		infants: 0,
		listingExternalId: "123",
		nightlyAverageMinor: 5000,
		nights: 2,
		pets: 0,
		provider: "hostify",
		providerPayload: {},
		subtotalMinor: 10_000,
		taxMinor: 600,
		totalMinor: 10_600,
		validationStatus: "valid",
	};
}

function listingSnapshot(): ListingDisplaySnapshot {
	return {
		city: "Porto",
		country: "Portugal",
		imageUrl: "https://example.com/home.jpg",
		listingId: "123",
		locationLabel: "Porto, Portugal",
		propertyTimezone: "Europe/Lisbon",
		provider: "hostify",
		title: "Porto Home",
	};
}

function contact(): DraftOrderContactInput {
	return {
		billingAddress: {},
		companyName: null,
		email: "guest@example.com",
		isCompany: false,
		name: "Guest Name",
		notes: null,
		phoneE164: "+351910000000",
		taxNumber: null,
	};
}
