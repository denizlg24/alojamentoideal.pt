import { describe, expect, test } from "bun:test";
import type { CommerceCatalogSnapshot } from "@workspace/db";
import { buildActivityDraftOrderRows } from "./orders";
import type {
	DraftOrderContactInput,
	NormalizedActivityQuoteSnapshot,
} from "./types";

function contact(): DraftOrderContactInput {
	return {
		billingAddress: {},
		companyName: null,
		dateOfBirth: null,
		email: "guest@example.com",
		firstName: null,
		isCompany: false,
		language: null,
		lastName: null,
		name: "Guest",
		notes: null,
		phoneE164: "+351910000000",
		taxNumber: null,
	};
}

function catalog(): CommerceCatalogSnapshot {
	return {
		city: "Porto",
		country: "PT",
		imageUrl: "https://img/act.jpg",
		listingId: "123",
		locationLabel: "Porto",
		provider: "bokun",
		title: "Douro Valley Tour",
	};
}

function quote(): NormalizedActivityQuoteSnapshot {
	return {
		activityDate: "2026-08-01",
		answers: [],
		bokunActivityId: "123",
		currency: "EUR",
		expiresAt: new Date("2026-07-07T10:10:00.000Z"),
		externalAccountId: "acct_1",
		fetchedAt: new Date("2026-07-07T10:00:00.000Z"),
		id: "quote_1",
		participants: [
			{
				count: 2,
				label: "Adult",
				pricingCategoryId: 1,
				subtotalMinor: 9000,
				unitPriceMinor: 4500,
			},
		],
		provider: "bokun",
		providerPayload: {},
		rateId: "rate_1",
		startTimeId: "st_1",
		subtotalMinor: 9000,
		taxMinor: 0,
		totalMinor: 9000,
		totalParticipants: 2,
		validationStatus: "valid",
	};
}

describe("buildActivityDraftOrderRows", () => {
	test("maps a normalized activity quote to a single activity order line", () => {
		const rows = buildActivityDraftOrderRows(
			{
				cartItemId: "item_1",
				position: 3,
				quote: quote(),
				snapshot: catalog(),
			},
			contact(),
		);

		expect(rows.item.type).toBe("activity");
		expect(rows.item.sourceCartItemId).toBe("item_1");
		expect(rows.item.position).toBe(3);
		expect(rows.item.totalMinor).toBe(9000);
		expect(rows.item.titleSnapshot).toBe("Douro Valley Tour");
		expect(rows.item.catalogSnapshot.listingId).toBe("123");

		expect(rows.detail.bokunActivityId).toBe("123");
		expect(rows.detail.activityDate).toBe("2026-08-01");
		expect(rows.detail.totalParticipants).toBe(2);
		expect(rows.detail.startTimeId).toBe("st_1");

		expect(rows.charges).toHaveLength(1);
		expect(rows.charges[0]?.kind).toBe("activity");
		expect(rows.charges[0]?.grossMinor).toBe(9000);
		expect(rows.charges[0]?.netMinor).toBe(9000);
		expect(rows.charges[0]?.unitNetMinor).toBe(4500);
	});

	test("splits net evenly per participant for the unit line", () => {
		const rows = buildActivityDraftOrderRows(
			{
				cartItemId: "item_2",
				position: 1,
				quote: { ...quote(), taxMinor: 900, totalParticipants: 3 },
				snapshot: catalog(),
			},
			contact(),
		);

		// net = 9000 - 900 = 8100, over 3 participants = 2700
		expect(rows.charges[0]?.taxMinor).toBe(900);
		expect(rows.charges[0]?.netMinor).toBe(8100);
		expect(rows.charges[0]?.unitNetMinor).toBe(2700);
	});
});
