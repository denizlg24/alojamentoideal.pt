import { describe, expect, test } from "bun:test";
import {
	canAcceptMember,
	generateMemberToken,
	hashMemberToken,
	INVITE_TOKEN_TTL_MS,
	isMemberTokenExpired,
	memberInviteExpiresAt,
	ORDER_PERMISSION_LIST,
	orderMemberCapacity,
	orderRoleCan,
} from "./order-access";
import { isOrderAccessGranted } from "./service";

describe("isOrderAccessGranted", () => {
	test("grants the linked user and denies everyone else", () => {
		const order = { cartToken: "tok", userId: "user_1" };
		expect(
			isOrderAccessGranted(order, { cartToken: null, userId: "user_1" }),
		).toBe(true);
		expect(
			isOrderAccessGranted(order, { cartToken: null, userId: "user_2" }),
		).toBe(false);
		// Anonymous caller cannot reach a user-linked order even with the token.
		expect(
			isOrderAccessGranted(order, { cartToken: "tok", userId: null }),
		).toBe(false);
	});

	test("grants an anonymous order only on a matching secret token", () => {
		const order = { cartToken: "secret-token", userId: null };
		expect(
			isOrderAccessGranted(order, { cartToken: "secret-token", userId: null }),
		).toBe(true);
		expect(
			isOrderAccessGranted(order, { cartToken: "other-token", userId: null }),
		).toBe(false);
		expect(isOrderAccessGranted(order, { cartToken: null, userId: null })).toBe(
			false,
		);
	});

	test("denies when the order has no originating cart token", () => {
		expect(
			isOrderAccessGranted(
				{ cartToken: null, userId: null },
				{ cartToken: "anything", userId: null },
			),
		).toBe(false);
	});
});

describe("orderRoleCan", () => {
	test("the owner holds every permission", () => {
		for (const permission of ORDER_PERMISSION_LIST) {
			expect(orderRoleCan("owner", permission)).toBe(true);
		}
	});

	test("a member may view, chat, and fill only their own guest slot", () => {
		expect(orderRoleCan("member", "view_booking")).toBe(true);
		expect(orderRoleCan("member", "chat")).toBe(true);
		expect(orderRoleCan("member", "manage_own_guest")).toBe(true);
	});

	test("a member cannot see price/contact or manage people or other guests", () => {
		expect(orderRoleCan("member", "view_price")).toBe(false);
		expect(orderRoleCan("member", "view_contact")).toBe(false);
		expect(orderRoleCan("member", "invite_members")).toBe(false);
		expect(orderRoleCan("member", "manage_members")).toBe(false);
		expect(orderRoleCan("member", "manage_all_guests")).toBe(false);
	});
});

describe("member access tokens", () => {
	test("a fresh token is 256-bit, URL-safe, and unique per call", () => {
		const first = generateMemberToken();
		const second = generateMemberToken();
		expect(first).not.toBe(second);
		expect(/^[A-Za-z0-9_-]+$/.test(first)).toBe(true);
		expect(Buffer.from(first, "base64url").length).toBe(32);
	});

	test("hashing is deterministic, 64-hex, and collision-distinct", () => {
		const token = generateMemberToken();
		const hash = hashMemberToken(token);
		expect(hash).toBe(hashMemberToken(token));
		expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
		expect(hashMemberToken("a")).not.toBe(hashMemberToken("b"));
	});
});

describe("isMemberTokenExpired", () => {
	const now = new Date("2026-06-27T12:00:00.000Z");

	test("a member without an expiry never lapses", () => {
		expect(isMemberTokenExpired({ expiresAt: null }, now)).toBe(false);
	});

	test("a future expiry is still valid; a past expiry has lapsed", () => {
		expect(
			isMemberTokenExpired(
				{ expiresAt: new Date("2026-06-28T00:00:00Z") },
				now,
			),
		).toBe(false);
		expect(
			isMemberTokenExpired(
				{ expiresAt: new Date("2026-06-27T00:00:00Z") },
				now,
			),
		).toBe(true);
	});
});

describe("memberInviteExpiresAt", () => {
	test("an invite lapses 24 hours from issue", () => {
		const now = new Date("2026-06-27T12:00:00.000Z");
		expect(memberInviteExpiresAt(now).getTime()).toBe(
			now.getTime() + INVITE_TOKEN_TTL_MS,
		);
		expect(INVITE_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
	});
});

describe("orderMemberCapacity", () => {
	test("registrable headcount is guests minus infants, summed per item", () => {
		expect(
			orderMemberCapacity([
				{ guests: 4, infants: 1 },
				{ guests: 2, infants: 0 },
			]),
		).toBe(5);
	});

	test("an empty order has no capacity, and infant-only counts never go negative", () => {
		expect(orderMemberCapacity([])).toBe(0);
		expect(orderMemberCapacity([{ guests: 1, infants: 3 }])).toBe(0);
	});
});

describe("canAcceptMember", () => {
	test("admits a new member only below capacity (the owner occupies a slot)", () => {
		// A solo booking (capacity 1) is full once the owner holds it.
		expect(canAcceptMember(1, 1)).toBe(false);
		// A two-guest booking admits the owner plus one accepted invite.
		expect(canAcceptMember(1, 2)).toBe(true);
		expect(canAcceptMember(2, 2)).toBe(false);
		// A zero-capacity order (no accommodation items) admits no one.
		expect(canAcceptMember(0, 0)).toBe(false);
	});
});
