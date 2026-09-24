import { afterAll, describe, expect, test } from "bun:test";
import {
	type AppliedDiscountSnapshot,
	activityQuoteSnapshot,
	apiIdempotencyKey,
	cart as cartTable,
	getDb,
	getPool,
} from "@workspace/db";
import { eq, like, sql } from "@workspace/db/query";
import { CommerceError } from "./errors";
import type { AddActivityCartItemBody } from "./schemas";
import { CommerceService } from "./service";
import type { CartOwner } from "./types";

/**
 * Integration coverage for the cart-item add/remove/re-add lifecycle against a
 * real Postgres (the migrated dev/CI database, see `db:up` / `db:migrate`).
 * Skips itself when the database is unreachable so `bun test` stays green on
 * machines without a running Postgres.
 */
async function databaseReachable(): Promise<boolean> {
	try {
		await getDb().execute(sql`select 1`);
		return true;
	} catch {
		return false;
	}
}

const dbAvailable = await databaseReachable();

const TEST_ACTIVITY_ID = `test-activity-${crypto.randomUUID()}`;
const UNIT_PRICE_MINOR = 5_000;

const createdCartIds: string[] = [];

function testService(
	resolveDiscount: (
		code: string,
	) => Promise<AppliedDiscountSnapshot | null> = async () => null,
): CommerceService {
	return new CommerceService({
		accountId: "test-account",
		currency: "EUR",
		db: getDb(),
		provider: "hostify",
		quoteAccommodation: async () => {
			throw new Error("accommodation quotes are not exercised by this test");
		},
		quoteActivity: async (input) => {
			const totalParticipants = input.participants.reduce(
				(sum, participant) => sum + participant.count,
				0,
			);
			const totalMinor = totalParticipants * UNIT_PRICE_MINOR;
			return {
				activityDate: input.activityDate,
				answers: input.answers,
				available: true,
				bokunActivityId: input.activityId,
				currency: "EUR",
				fetchedAt: new Date(),
				participants: input.participants.map((participant) => ({
					count: participant.count,
					label: "Adult",
					pricingCategoryId: participant.pricingCategoryId,
					subtotalMinor: participant.count * UNIT_PRICE_MINOR,
					unitPriceMinor: UNIT_PRICE_MINOR,
				})),
				rateId: input.rateId ?? null,
				startTimeId: input.startTimeId ?? null,
				subtotalMinor: totalMinor,
				taxMinor: 0,
				totalMinor,
				totalParticipants,
			};
		},
		quoteTtlSeconds: 900,
		resolveDiscount,
	});
}

function activityAddBody(idempotencyKey: string): AddActivityCartItemBody {
	return {
		activityDate: "2026-08-01",
		activityId: TEST_ACTIVITY_ID,
		answers: [],
		clientMutationId: "test-activity-selection",
		idempotencyKey,
		participants: [{ count: 2, pricingCategoryId: 1 }],
		rateId: null,
		startTimeId: null,
		type: "activity",
	};
}

async function createOwnedCart(
	service: CommerceService,
): Promise<{ cartId: string; owner: CartOwner }> {
	const anonymous: CartOwner = { cartToken: null, userId: null };
	const { cart } = await service.createCart({}, anonymous);
	createdCartIds.push(cart.id);
	return {
		cartId: cart.id,
		owner: { cartToken: cart.cartToken, userId: null },
	};
}

afterAll(async () => {
	if (!dbAvailable) {
		return;
	}
	const db = getDb();
	for (const cartId of createdCartIds) {
		await db
			.delete(apiIdempotencyKey)
			.where(like(apiIdempotencyKey.scope, `cart:${cartId}:%`));
		// Cart items cascade with the cart; quote snapshots (restrict FK) follow.
		await db.delete(cartTable).where(eq(cartTable.id, cartId));
	}
	await db
		.delete(activityQuoteSnapshot)
		.where(eq(activityQuoteSnapshot.bokunActivityId, TEST_ACTIVITY_ID));
	await getPool().end();
});

describe.skipIf(!dbAvailable)("cart item re-add after removal", () => {
	test("a fresh idempotency key resurrects the removed item via its clientMutationId", async () => {
		const service = testService();
		const { cartId, owner } = await createOwnedCart(service);

		const first = await service.addItem(
			cartId,
			activityAddBody("test-add-first"),
			owner,
		);
		expect(first.item.status).toBe("active");
		expect(first.cart.items).toHaveLength(1);
		expect(first.cart.totalMinor).toBe(10_000);

		const removed = await service.removeItem(cartId, first.item.id, {}, owner);
		expect(removed.cart.items).toHaveLength(0);
		expect(removed.cart.totalMinor).toBe(0);

		const readded = await service.addItem(
			cartId,
			activityAddBody("test-add-second"),
			owner,
		);
		expect(readded.item.id).toBe(first.item.id);
		expect(readded.item.status).toBe("active");
		expect(readded.cart.items).toHaveLength(1);
		expect(readded.cart.totalMinor).toBe(10_000);

		const { cart } = await service.getCart(cartId, owner);
		expect(cart.items).toHaveLength(1);
		expect(cart.totalMinor).toBe(10_000);
	});

	test("reusing the original idempotency key replays the stale response and does not re-add", async () => {
		// Pins the server contract the web client relies on: an idempotency-key
		// replay echoes the stored response without touching the cart, so a re-add
		// after removal MUST send a fresh key (the clientMutationId alone dedupes
		// identical selections). If replay semantics ever become liveness-aware,
		// update apps/web cart-store accordingly.
		const service = testService();
		const { cartId, owner } = await createOwnedCart(service);

		const first = await service.addItem(
			cartId,
			activityAddBody("test-add-replayed"),
			owner,
		);
		await service.removeItem(cartId, first.item.id, {}, owner);

		const replayed = await service.addItem(
			cartId,
			activityAddBody("test-add-replayed"),
			owner,
		);
		// The echoed snapshot still claims the item is in the cart...
		expect(replayed.item.id).toBe(first.item.id);
		expect(replayed.cart.updatedAt).toBe(first.cart.updatedAt);
		expect(replayed.cart.items).toHaveLength(1);

		// ...but the authoritative cart still has it removed.
		const { cart } = await service.getCart(cartId, owner);
		expect(cart.items).toHaveLength(0);
		expect(cart.totalMinor).toBe(0);
	});
});

function tenPercentOff(
	scope: AppliedDiscountSnapshot["scope"],
): AppliedDiscountSnapshot {
	return {
		amountMinor: null,
		couponId: "co_test",
		currency: null,
		percentBasisPoints: 1000,
		promotionCode: "TEN",
		scope,
		source: "stripe",
		type: "percentage",
	};
}

describe.skipIf(!dbAvailable)("scoped promotion codes", () => {
	test("an activity-scoped code discounts activity items", async () => {
		const service = testService(async () => tenPercentOff("activities"));
		const { cartId, owner } = await createOwnedCart(service);
		await service.addItem(cartId, activityAddBody("test-scope-add"), owner);

		const { cart } = await service.applyDiscount(
			cartId,
			{ code: "TEN" },
			owner,
		);
		expect(cart.discountMinor).toBe(1000);
		expect(cart.totalMinor).toBe(9000);
		expect(cart.appliedDiscount?.scope).toBe("activities");
	});

	test("a housing-only code is refused on a cart of activities", async () => {
		const service = testService(async () => tenPercentOff("housing"));
		const { cartId, owner } = await createOwnedCart(service);
		await service.addItem(
			cartId,
			activityAddBody("test-scope-add-housing"),
			owner,
		);

		const attempt = service.applyDiscount(cartId, { code: "TEN" }, owner);
		await expect(attempt).rejects.toBeInstanceOf(CommerceError);
		await expect(attempt).rejects.toThrow(
			"This promotion code only applies to homes.",
		);

		const { cart } = await service.getCart(cartId, owner);
		expect(cart.appliedDiscount).toBeNull();
		expect(cart.totalMinor).toBe(10_000);
	});

	test("checkout re-prices the cart when a code's scope changed since it was applied", async () => {
		let scope: AppliedDiscountSnapshot["scope"] = "all";
		const service = testService(async () => tenPercentOff(scope));
		const { cartId, owner } = await createOwnedCart(service);
		await service.addItem(cartId, activityAddBody("test-scope-drift"), owner);
		const applied = await service.applyDiscount(cartId, { code: "TEN" }, owner);
		expect(applied.cart.totalMinor).toBe(9000);

		scope = "housing";
		const attempt = service.createDraftOrder(
			{
				cartId,
				contact: {
					billingAddress: {},
					companyName: null,
					dateOfBirth: null,
					email: "guest@example.com",
					firstName: "Test",
					isCompany: false,
					language: "en",
					lastName: "Guest",
					name: "Test Guest",
					notes: null,
					phoneE164: "+351910000000",
					taxNumber: null,
				},
			},
			owner,
		);
		await expect(attempt).rejects.toMatchObject({ code: "cart_changed" });

		const { cart } = await service.getCart(cartId, owner);
		expect(cart.appliedDiscount?.scope).toBe("housing");
		expect(cart.discountMinor).toBe(0);
		expect(cart.totalMinor).toBe(10_000);
	});
});
