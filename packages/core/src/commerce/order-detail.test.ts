import { describe, expect, test } from "bun:test";
import type { BookingGuestIdentityStatus } from "@workspace/db";
import {
	summarizeConversationAvailability,
	summarizeGuestProgress,
} from "./order-detail";

describe("summarizeGuestProgress", () => {
	test("an empty set is zeroed", () => {
		expect(summarizeGuestProgress([])).toEqual({
			missing: 0,
			pending: 0,
			total: 0,
			verified: 0,
		});
	});

	test("counts missing and verified at the extremes", () => {
		const statuses: BookingGuestIdentityStatus[] = [
			"missing",
			"missing",
			"verified",
		];
		expect(summarizeGuestProgress(statuses)).toEqual({
			missing: 2,
			pending: 0,
			total: 3,
			verified: 1,
		});
	});

	test("folds every non-terminal state into pending", () => {
		const statuses: BookingGuestIdentityStatus[] = [
			"provided",
			"processing",
			"requires_input",
			"canceled",
			"verified",
			"missing",
		];
		expect(summarizeGuestProgress(statuses)).toEqual({
			missing: 1,
			pending: 4,
			total: 6,
			verified: 1,
		});
	});
});

describe("summarizeConversationAvailability", () => {
	test("reports unavailable when no conversation exists", () => {
		expect(summarizeConversationAvailability([])).toBe("unavailable");
	});

	test("reports pending until an active external thread is linked", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: null, status: "pending" },
			]),
		).toBe("pending");
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: "thread_1", status: "archived" },
			]),
		).toBe("pending");
	});

	test("reports available for an active linked thread", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: "thread_1", status: "active" },
			]),
		).toBe("available");
	});
});
