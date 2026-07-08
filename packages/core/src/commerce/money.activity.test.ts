import { describe, expect, test } from "bun:test";
import {
	type ActivityQuoteResult,
	normalizeActivityQuoteSnapshot,
} from "./money";

function quote(
	overrides: Partial<ActivityQuoteResult> = {},
): ActivityQuoteResult {
	return {
		activityDate: "2026-08-01",
		answers: [],
		available: true,
		bokunActivityId: "123",
		currency: "eur",
		fetchedAt: "2026-07-07T10:00:00.000Z",
		participants: [
			{
				count: 2,
				label: "Adult",
				pricingCategoryId: 1,
				subtotalMinor: 9000,
				unitPriceMinor: 4500,
			},
		],
		rateId: "rate_1",
		startTimeId: "st_1",
		subtotalMinor: 9000,
		taxMinor: 0,
		totalMinor: 9000,
		totalParticipants: 2,
		...overrides,
	};
}

describe("normalizeActivityQuoteSnapshot", () => {
	test("assigns scope/identity, upper-cases currency and derives expiry from ttl", () => {
		const snapshot = normalizeActivityQuoteSnapshot({
			accountId: "acct_1",
			provider: "bokun",
			quote: quote(),
			quoteId: "quote_1",
			ttlSeconds: 600,
		});

		expect(snapshot.id).toBe("quote_1");
		expect(snapshot.externalAccountId).toBe("acct_1");
		expect(snapshot.provider).toBe("bokun");
		expect(snapshot.currency).toBe("EUR");
		expect(snapshot.totalMinor).toBe(9000);
		expect(snapshot.totalParticipants).toBe(2);
		expect(snapshot.validationStatus).toBe("valid");
		expect(snapshot.expiresAt.toISOString()).toBe("2026-07-07T10:10:00.000Z");
	});

	test("marks a sold-out departure unavailable", () => {
		const snapshot = normalizeActivityQuoteSnapshot({
			accountId: "acct_1",
			provider: "bokun",
			quote: quote({ available: false }),
			ttlSeconds: 600,
		});

		expect(snapshot.validationStatus).toBe("unavailable");
	});

	test("prefers an explicit provider expiry over the ttl", () => {
		const snapshot = normalizeActivityQuoteSnapshot({
			accountId: "acct_1",
			provider: "bokun",
			quote: quote({ expiresAt: "2026-07-07T10:30:00.000Z" }),
			ttlSeconds: 600,
		});

		expect(snapshot.expiresAt.toISOString()).toBe("2026-07-07T10:30:00.000Z");
	});
});
