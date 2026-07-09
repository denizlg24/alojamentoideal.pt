import { describe, expect, test } from "bun:test";
import type { BookingGuestIdentityStatus } from "@workspace/db";
import {
	scopeGuestRowsToViewer,
	scopeOrderItemsToViewer,
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

describe("scopeGuestRowsToViewer", () => {
	const rows = [
		{ id: "slot-a1", orderMemberId: null },
		{ id: "slot-a2", orderMemberId: "member-1" },
		{ id: "slot-b1", orderMemberId: "member-2" },
	];

	test("the owner counts every slot in the order", () => {
		expect(scopeGuestRowsToViewer(rows, "owner", null)).toEqual(rows);
		expect(scopeGuestRowsToViewer(rows, "owner", "member-9")).toEqual(rows);
	});

	test("a member counts only the slots bound to their membership", () => {
		expect(scopeGuestRowsToViewer(rows, "member", "member-1")).toEqual([
			{ id: "slot-a2", orderMemberId: "member-1" },
		]);
	});

	test("a member with no bound slot counts nothing", () => {
		expect(scopeGuestRowsToViewer(rows, "member", "member-9")).toEqual([]);
	});

	test("a member without a member row counts nothing", () => {
		expect(scopeGuestRowsToViewer(rows, "member", null)).toEqual([]);
	});
});

describe("scopeOrderItemsToViewer", () => {
	const items = [
		{ bookingId: "booking-a", id: "item-1" },
		{ bookingId: "booking-b", id: "item-2" },
		{ bookingId: null, id: "item-activity" },
	];

	test("the owner sees every item, bookable or not", () => {
		expect(scopeOrderItemsToViewer(items, "owner", new Set())).toEqual(items);
	});

	test("a member only sees the stays their slots are bound to", () => {
		expect(
			scopeOrderItemsToViewer(items, "member", new Set(["booking-a"])),
		).toEqual([{ bookingId: "booking-a", id: "item-1" }]);
	});

	test("a member invited to several bookings sees each of those stays", () => {
		expect(
			scopeOrderItemsToViewer(
				items,
				"member",
				new Set(["booking-a", "booking-b"]),
			),
		).toEqual([
			{ bookingId: "booking-a", id: "item-1" },
			{ bookingId: "booking-b", id: "item-2" },
		]);
	});

	test("a member with no bound booking sees nothing", () => {
		expect(scopeOrderItemsToViewer(items, "member", new Set())).toEqual([]);
	});
});

describe("summarizeConversationAvailability", () => {
	test("reports unavailable when no conversation exists", () => {
		expect(summarizeConversationAvailability([])).toBe("unavailable");
	});

	test("reports pending until an active external thread is linked", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: null, provider: "hostify", status: "pending" },
			]),
		).toBe("pending");
		expect(
			summarizeConversationAvailability([
				{
					externalThreadId: "thread_1",
					provider: "hostify",
					status: "archived",
				},
			]),
		).toBe("pending");
	});

	test("reports available for an active linked thread", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: "thread_1", provider: "hostify", status: "active" },
			]),
		).toBe("available");
	});

	test("reports available for an active internal conversation with no thread", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: null, provider: "internal", status: "active" },
			]),
		).toBe("available");
	});

	test("an archived internal conversation stays pending", () => {
		expect(
			summarizeConversationAvailability([
				{ externalThreadId: null, provider: "internal", status: "archived" },
			]),
		).toBe("pending");
	});
});
