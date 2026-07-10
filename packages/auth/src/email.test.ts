import { describe, expect, test } from "bun:test";
import {
	buildActivityQuestionsReminderEmail,
	buildOrderConfirmationEmail,
	buildOrderRefundEmail,
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

describe("buildOrderRefundEmail", () => {
	test("names a cancelled attributed reservation", () => {
		const message = buildOrderRefundEmail({
			amount: "€64.00",
			greeting: "Hi Ana,",
			itemTitle: "Douro Valley Walk",
			orderNumber: "AI-123",
		});

		expect(message.subject).toBe("Refund issued for booking AI-123");
		expect(message.text.includes("refund of €64.00")).toBe(true);
		expect(
			message.text.includes("cancelled your reservation for Douro Valley Walk"),
		).toBe(true);
	});

	test("does not claim an unattributed refund cancelled a reservation", () => {
		const message = buildOrderRefundEmail({
			amount: "€20.00",
			greeting: "Hi there,",
			orderNumber: "AI-456",
		});

		expect(message.text.includes("reservations remain unchanged")).toBe(true);
	});
});

describe("buildActivityQuestionsReminderEmail", () => {
	test("renders singular question wording for activity reminders", () => {
		const message = buildActivityQuestionsReminderEmail({
			activityDate: "Sat, 1 Aug 2026",
			activityTitle: "Sunset Kayak Tour",
			manageUrl: "https://alojamentoideal.pt/order/AI-123/activity/item-1",
			missingQuestionCount: 1,
			orderNumber: "AI-123",
		});

		expect(message.subject).toBe(
			"Information needed for your activity on booking AI-123",
		);
		expect(message.text.includes("Sunset Kayak Tour")).toBe(true);
		expect(message.text.includes("an answer to 1 question")).toBe(true);
		expect(message.text.includes("Sat, 1 Aug 2026")).toBe(true);
		expect(message.html.includes("Sunset Kayak Tour")).toBe(true);
		expect(message.text.includes("Your Alojamento Ideal stay")).toBe(false);
		expect(message.html.includes("Your Alojamento Ideal stay")).toBe(false);
	});

	test("renders plural question wording for activity reminders", () => {
		const message = buildActivityQuestionsReminderEmail({
			activityDate: "Sun, 2 Aug 2026",
			activityTitle: "Douro Valley Walk",
			manageUrl: "https://alojamentoideal.pt/order/AI-456/activity/item-2",
			missingQuestionCount: 3,
			orderNumber: "AI-456",
		});

		expect(message.subject).toBe(
			"Information needed for your activity on booking AI-456",
		);
		expect(message.text.includes("Douro Valley Walk")).toBe(true);
		expect(message.text.includes("answers to 3 questions")).toBe(true);
		expect(message.text.includes("Sun, 2 Aug 2026")).toBe(true);
		expect(message.text.includes("Your Alojamento Ideal stay")).toBe(false);
	});
});
