import { describe, expect, test } from "bun:test";
import {
	buildOrderConfirmationEmail,
	type OrderConfirmationEmailInput,
} from "./email";

function input(
	overrides: Partial<OrderConfirmationEmailInput>,
): OrderConfirmationEmailInput {
	return {
		activities: [],
		billingAddress: "Rua A, Porto",
		contactEmail: "guest@example.com",
		contactPhone: "+351 900 000 000",
		email: "guest@example.com",
		manageUrl: "https://alojamentoideal.pt/booking/ABC123",
		orderNumber: "ABC123",
		paymentMethod: "Visa",
		stays: [],
		totalPrice: "€120.00",
		...overrides,
	};
}

const stay = {
	checkIn: "1 Aug 2026",
	checkOut: "4 Aug 2026",
	guests: "2 guests",
	image: "",
	nights: "3 nights",
	title: "Casa Azul",
};

const activity = {
	date: "Sat, 1 Aug 2026",
	image: "",
	participants: "3 participants",
	title: "Sunset Kayak Tour",
};

// Assertions target values (not label prefixes) so they hold whether the
// branded `@workspace/emails` template is built or the inline fallback runs.
describe("buildOrderConfirmationEmail", () => {
	test("renders an activity-only order without stay wording", () => {
		const message = buildOrderConfirmationEmail(
			input({ activities: [activity] }),
		);
		expect(message.subject).toBe("Booking confirmed at Sunset Kayak Tour");
		expect(
			message.text.includes("Your booking for Sunset Kayak Tour is confirmed."),
		).toBe(true);
		expect(message.text.includes("Sat, 1 Aug 2026")).toBe(true);
		expect(message.text.includes("3 participants")).toBe(true);
		expect(message.html.includes("Sunset Kayak Tour")).toBe(true);
		// No phantom fallback stay leaks into an activity-only email.
		expect(message.text.includes("Your Alojamento Ideal stay")).toBe(false);
	});

	test("keeps the original wording for a stays-only order", () => {
		const message = buildOrderConfirmationEmail(input({ stays: [stay] }));
		expect(message.subject).toBe("Booking confirmed at Casa Azul");
		expect(message.text.includes("Your stay at Casa Azul is confirmed.")).toBe(
			true,
		);
		expect(message.text.includes("1 Aug 2026")).toBe(true);
	});

	test("counts a mixed order as bookings", () => {
		const message = buildOrderConfirmationEmail(
			input({ activities: [activity], stays: [stay] }),
		);
		expect(message.subject).toBe(
			"Booking confirmed at Casa Azul and 1 more booking",
		);
		expect(message.text.includes("Your 2 bookings are confirmed.")).toBe(true);
		expect(message.text.includes("Casa Azul")).toBe(true);
		expect(message.text.includes("Sunset Kayak Tour")).toBe(true);
	});
});
