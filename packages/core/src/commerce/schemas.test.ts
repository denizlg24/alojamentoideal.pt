import { describe, expect, test } from "bun:test";
import {
	parseAddCartItemBody,
	parseApplyDiscountBody,
	parseCreateCartBody,
	parseDeleteCartItemBody,
	parseDraftOrderBody,
	parseUpdateCartItemBody,
} from "./schemas";

describe("commerce request parsers", () => {
	test("accepts bodyless create-cart requests", () => {
		const parsed = parseCreateCartBody(null);

		expect(parsed.success).toBe(true);
	});

	test("accepts create-cart requests with cart and idempotency ids", () => {
		const parsed = parseCreateCartBody({
			cartId: "11111111-1111-4111-8111-111111111111",
			idempotencyKey: "create-123",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.cartId).toBe("11111111-1111-4111-8111-111111111111");
		expect(parsed.data.idempotencyKey).toBe("create-123");
	});

	test("rejects a non-UUID cart id", () => {
		const parsed = parseCreateCartBody({ cartId: "cart_1" });

		expect(parsed.success).toBe(false);
	});

	test("accepts a discount apply request", () => {
		const parsed = parseApplyDiscountBody({
			code: "SAVE10",
			idempotencyKey: "discount-123",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.code).toBe("SAVE10");
		expect(parsed.data.idempotencyKey).toBe("discount-123");
	});

	test("rejects a discount request without a code", () => {
		const parsed = parseApplyDiscountBody({ idempotencyKey: "discount-123" });

		expect(parsed.success).toBe(false);
	});

	test("rejects discount codes with spaces or punctuation", () => {
		const parsed = parseApplyDiscountBody({
			code: "SAVE 10!",
			idempotencyKey: "discount-123",
		});

		expect(parsed.success).toBe(false);
	});

	test("accepts bodyless delete-cart-item requests", () => {
		const parsed = parseDeleteCartItemBody(null);

		expect(parsed.success).toBe(true);
	});

	test("requires idempotency keys when adding items", () => {
		const parsed = parseAddCartItemBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			guests: 2,
			listingId: "123",
		});

		expect(parsed.success).toBe(false);
	});

	test("accepts add-cart item requests with optional fields", () => {
		const parsed = parseAddCartItemBody({
			adults: 2,
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			children: 2,
			clientMutationId: "client-123",
			guests: 4,
			idempotencyKey: "add-12345",
			infants: 1,
			listingId: "123",
			pets: 1,
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data).toMatchObject({
			adults: 2,
			children: 2,
			clientMutationId: "client-123",
			forceFresh: true,
			guests: 4,
			idempotencyKey: "add-12345",
			infants: 1,
			listingId: "123",
			pets: 1,
		});
	});

	test("accepts partial cart item updates with idempotency keys", () => {
		const parsed = parseUpdateCartItemBody({
			guests: 4,
			idempotencyKey: "update-123",
		});

		expect(parsed.success).toBe(true);
		expect(parsed).toMatchObject({
			data: { guests: 4 },
			success: true,
		});
	});

	test("accepts date and listing changes in cart item updates", () => {
		const parsed = parseUpdateCartItemBody({
			checkIn: "2026-08-01",
			checkOut: "2026-08-05",
			idempotencyKey: "update-dates-123",
			listingId: "456",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.checkIn).toBe("2026-08-01");
		expect(parsed.data.checkOut).toBe("2026-08-05");
		expect(parsed.data.listingId).toBe("456");
	});

	test("rejects short or malformed idempotency keys", () => {
		expect(
			parseUpdateCartItemBody({
				guests: 2,
				idempotencyKey: "short",
			}).success,
		).toBe(false);
		expect(
			parseAddCartItemBody({
				checkIn: "2026-07-01",
				checkOut: "2026-07-03",
				guests: 2,
				idempotencyKey: "has spaces",
				listingId: "123",
			}).success,
		).toBe(false);
	});

	test("rejects guest counts above the supported limit", () => {
		const parsed = parseAddCartItemBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			guests: 31,
			idempotencyKey: "add-12345",
			listingId: "123",
		});

		expect(parsed.success).toBe(false);
	});

	test("accepts draft orders with nested contact and lowercases email", () => {
		const parsed = parseDraftOrderBody({
			cartId: "cart_1",
			contact: {
				email: "GUEST@EXAMPLE.COM",
				name: "Guest Name",
				phoneE164: "+351910000000",
			},
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.contact.email).toBe("guest@example.com");
		expect(parsed.data.contact.phoneE164).toBe("+351910000000");
	});

	test("accepts draft orders reconstructed from flat contact fields", () => {
		const parsed = parseDraftOrderBody({
			cartId: "cart_1",
			email: "guest@example.com",
			name: "Guest Name",
			phone: "+351910000000",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.contact.name).toBe("Guest Name");
		expect(parsed.data.contact.phoneE164).toBe("+351910000000");
	});

	test("accepts draft orders with complete billing addresses", () => {
		const billingAddress = {
			city: "Porto",
			country: "Portugal",
			line1: "Rua Central 1",
			line2: "2A",
			postalCode: "4000-001",
			region: "Porto",
		};
		const parsed = parseDraftOrderBody({
			billingAddress,
			cartId: "cart_1",
			email: "guest@example.com",
			name: "Guest Name",
			phoneE164: "+351910000000",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.contact.billingAddress).toEqual(billingAddress);
	});

	test("accepts draft orders with company fields", () => {
		const parsed = parseDraftOrderBody({
			cartId: "cart_1",
			companyName: "Guest Company",
			email: "guest@example.com",
			isCompany: true,
			name: "Guest Name",
			phoneE164: "+351910000000",
			taxNumber: "PT123456789",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.contact.isCompany).toBe(true);
		expect(parsed.data.contact.companyName).toBe("Guest Company");
		expect(parsed.data.contact.taxNumber).toBe("PT123456789");
	});

	test("accepts draft order notes", () => {
		const parsed = parseDraftOrderBody({
			cartId: "cart_1",
			email: "guest@example.com",
			name: "Guest Name",
			notes: "Late arrival after 22:00",
			phoneE164: "+351910000000",
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			throw parsed.error;
		}
		expect(parsed.data.contact.notes).toBe("Late arrival after 22:00");
	});

	test("requires either phone or phoneE164 for draft order contacts", () => {
		const parsed = parseDraftOrderBody({
			cartId: "cart_1",
			email: "guest@example.com",
			name: "Guest Name",
		});

		expect(parsed.success).toBe(false);
	});

	test("rejects invalid billing address field shapes", () => {
		const parsed = parseDraftOrderBody({
			billingAddress: { line1: "" },
			cartId: "cart_1",
			email: "guest@example.com",
			name: "Guest Name",
			phoneE164: "+351910000000",
		});

		expect(parsed.success).toBe(false);
	});
});
