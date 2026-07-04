import { describe, expect, it } from "bun:test";
import { normalizeHostifyReservationStatus } from "./reservation-admin";

describe("normalizeHostifyReservationStatus", () => {
	it("maps Hostify statuses to normalized provider-booking statuses", () => {
		expect(normalizeHostifyReservationStatus("accepted")).toBe("confirmed");
		expect(normalizeHostifyReservationStatus("denied")).toBe("failed");
		expect(normalizeHostifyReservationStatus("cancelled_by_host")).toBe(
			"cancelled",
		);
		expect(normalizeHostifyReservationStatus("cancelled_by_guest")).toBe(
			"cancelled",
		);
		expect(normalizeHostifyReservationStatus("no_show")).toBe("completed");
	});

	it("falls back to pending for unknown or pending statuses", () => {
		expect(normalizeHostifyReservationStatus("pending")).toBe("pending");
		expect(normalizeHostifyReservationStatus("something_new")).toBe("pending");
	});
});
