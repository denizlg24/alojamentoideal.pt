import { describe, expect, test } from "bun:test";
import {
	mapStripePaymentStatus,
	toOrderBookingStatus,
	toOrderProvisioningSubState,
} from "./payments";

describe("mapStripePaymentStatus", () => {
	test("maps the statuses checkout cares about", () => {
		expect(mapStripePaymentStatus("succeeded")).toBe("succeeded");
		expect(mapStripePaymentStatus("processing")).toBe("processing");
		expect(mapStripePaymentStatus("requires_capture")).toBe("processing");
		expect(mapStripePaymentStatus("requires_action")).toBe("requires_action");
		expect(mapStripePaymentStatus("requires_confirmation")).toBe(
			"requires_action",
		);
		expect(mapStripePaymentStatus("requires_payment_method")).toBe(
			"requires_payment_method",
		);
		expect(mapStripePaymentStatus("canceled")).toBe("canceled");
	});

	test("degrades unknown statuses to unknown", () => {
		expect(mapStripePaymentStatus("something_new")).toBe("unknown");
		expect(mapStripePaymentStatus("")).toBe("unknown");
	});
});

describe("toOrderBookingStatus", () => {
	test("passes through known lifecycle values", () => {
		for (const status of [
			"draft",
			"pending",
			"confirmed",
			"cancelled",
			"failed",
		] as const) {
			expect(toOrderBookingStatus(status)).toBe(status);
		}
	});

	test("falls back to draft for unexpected values", () => {
		expect(toOrderBookingStatus("weird")).toBe("draft");
	});
});

describe("toOrderProvisioningSubState", () => {
	test("distinguishes held, paid, confirmed, cancelled, and refunded states", () => {
		expect(
			toOrderProvisioningSubState({
				amountPaidMinor: 0,
				amountRefundedMinor: 0,
				bookingStatus: "pending",
			}),
		).toBe("held-unpaid");
		expect(
			toOrderProvisioningSubState({
				amountPaidMinor: 1000,
				amountRefundedMinor: 0,
				bookingStatus: "pending",
			}),
		).toBe("paid-confirming");
		expect(
			toOrderProvisioningSubState({
				amountPaidMinor: 1000,
				amountRefundedMinor: 0,
				bookingStatus: "confirmed",
			}),
		).toBe("confirmed");
		expect(
			toOrderProvisioningSubState({
				amountPaidMinor: 1000,
				amountRefundedMinor: 1000,
				bookingStatus: "cancelled",
			}),
		).toBe("refunded");
		expect(
			toOrderProvisioningSubState({
				amountPaidMinor: 0,
				amountRefundedMinor: 0,
				bookingStatus: "cancelled",
			}),
		).toBe("cancelled");
	});
});
