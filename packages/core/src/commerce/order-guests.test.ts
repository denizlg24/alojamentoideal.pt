import { describe, expect, test } from "bun:test";
import {
	bookingGuestPurgeAfter,
	identityStatusToBookingGuestStatus,
} from "./order-guests";

describe("bookingGuestPurgeAfter", () => {
	test("uses the later of stay end and now, plus the support window", () => {
		const now = new Date("2026-06-30T12:00:00.000Z");
		expect(
			bookingGuestPurgeAfter(
				new Date("2026-07-10T00:00:00.000Z"),
				now,
			).toISOString(),
		).toBe("2026-10-08T00:00:00.000Z");
		expect(
			bookingGuestPurgeAfter(
				new Date("2026-06-01T00:00:00.000Z"),
				now,
			).toISOString(),
		).toBe("2026-09-28T12:00:00.000Z");
	});
});

describe("identityStatusToBookingGuestStatus", () => {
	test("maps Stripe account identity statuses to booking guest statuses", () => {
		expect(identityStatusToBookingGuestStatus("processing")).toBe("processing");
		expect(identityStatusToBookingGuestStatus("requires_input")).toBe(
			"requires_input",
		);
		expect(identityStatusToBookingGuestStatus("verified")).toBe("verified");
		expect(identityStatusToBookingGuestStatus("canceled")).toBe("canceled");
	});
});
