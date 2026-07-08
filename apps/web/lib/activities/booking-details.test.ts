import { describe, expect, test } from "bun:test";
import type {
	ActivityBookingSchema,
	ActivityQuestionField,
} from "@workspace/core/activities";
import type { ActivityCartItemDto } from "@workspace/core/commerce";
import {
	buildActivityDetailInput,
	describeActivityBooking,
	emptyActivityDraft,
	isActivityDetailComplete,
} from "./booking-details";

function field(
	overrides: Partial<ActivityQuestionField> & { questionId: string },
): ActivityQuestionField {
	return {
		dataFormat: null,
		dataType: "SHORT_TEXT",
		label: overrides.questionId,
		options: [],
		required: true,
		selectFromOptions: false,
		selectMultiple: false,
		...overrides,
	};
}

function item(
	participants: { count: number; pricingCategoryId: number; label: string }[],
): ActivityCartItemDto {
	return {
		activityDate: "2026-08-01",
		activityId: "activity-1",
		currency: "EUR",
		id: "cart-item-1",
		imageUrl: null,
		participants: participants.map((participant) => ({
			...participant,
			subtotalMinor: 0,
			unitPriceMinor: 0,
		})),
		position: 0,
		quote: {
			currency: "EUR",
			expiresAt: "2026-08-01T00:00:00.000Z",
			feeLines: [],
			fetchedAt: "2026-07-08T00:00:00.000Z",
			id: "quote-1",
			status: "valid",
			subtotalMinor: 0,
			taxMinor: 0,
			totalMinor: 0,
		},
		rateId: "rate-1",
		startTimeId: "start-1",
		status: "active",
		subtotalMinor: 0,
		taxMinor: 0,
		title: "City Walking Tour",
		totalMinor: 0,
		totalParticipants: participants.reduce(
			(sum, participant) => sum + participant.count,
			0,
		),
		type: "activity",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function schema(
	overrides: Partial<ActivityBookingSchema>,
): ActivityBookingSchema {
	return {
		activityId: "activity-1",
		activityQuestions: [],
		dropoff: null,
		mainContactFields: [],
		passengers: [],
		pickup: null,
		...overrides,
	};
}

describe("describeActivityBooking", () => {
	test("skips contact-form main-contact fields and keeps required provider-only fields", () => {
		const desc = describeActivityBooking(
			item([{ count: 1, label: "Adult", pricingCategoryId: 1 }]),
			schema({
				mainContactFields: [
					field({ questionId: "firstName" }),
					field({ questionId: "lastName" }),
					field({ questionId: "email" }),
					field({ questionId: "phoneNumber" }),
					field({ questionId: "language" }),
					field({ questionId: "dateOfBirth" }),
					field({ questionId: "title" }),
					field({ questionId: "optionalNote", required: false }),
					field({ questionId: "passportNumber" }),
				],
			}),
		);
		expect(desc.contactQuestions.map((entry) => entry.questionId)).toEqual([
			"language",
			"dateOfBirth",
			"title",
			"passportNumber",
		]);
	});

	test("expands passengers in participant order with global indices", () => {
		const desc = describeActivityBooking(
			item([
				{ count: 2, label: "Adult", pricingCategoryId: 1 },
				{ count: 1, label: "Child", pricingCategoryId: 2 },
			]),
			schema({
				passengers: [
					{
						fields: [field({ questionId: "weight" })],
						pricingCategoryId: 1,
						title: "Adult",
						type: null,
					},
				],
			}),
		);
		// Only the adult category has required fields, so two passenger groups
		// (indices 0 and 1); the child at index 2 contributes none.
		expect(desc.passengers.map((group) => group.participantIndex)).toEqual([
			0, 1,
		]);
		expect(desc.passengers.map((group) => group.label)).toEqual([
			"Adult 1",
			"Adult 2",
		]);
	});

	test("marks a multi-option pickup selectable but a single/preselected one not", () => {
		const selectable = describeActivityBooking(
			item([{ count: 1, label: "Adult", pricingCategoryId: 1 }]),
			schema({
				pickup: {
					customerSelectable: true,
					places: [
						{ askForRoomNumber: false, id: "10", title: "Hotel A" },
						{ askForRoomNumber: false, id: "11", title: "Hotel B" },
					],
					required: true,
					roomNumberField: null,
				},
			}),
		);
		expect(selectable.pickup?.selectable).toBe(true);
		expect(selectable.needsInput).toBe(true);

		const preselected = describeActivityBooking(
			item([{ count: 1, label: "Adult", pricingCategoryId: 1 }]),
			schema({
				pickup: {
					customerSelectable: false,
					places: [{ askForRoomNumber: false, id: "10", title: "Depot" }],
					required: true,
					roomNumberField: null,
				},
			}),
		);
		expect(preselected.pickup?.selectable).toBe(false);
		expect(preselected.pickup?.autoPlaceId).toBe("10");
		expect(preselected.needsInput).toBe(false);
	});
});

describe("isActivityDetailComplete", () => {
	const desc = describeActivityBooking(
		item([{ count: 1, label: "Adult", pricingCategoryId: 1 }]),
		schema({
			activityQuestions: [field({ questionId: "dietary" })],
			pickup: {
				customerSelectable: true,
				places: [
					{ askForRoomNumber: true, id: "10", title: "Hotel A" },
					{ askForRoomNumber: false, id: "11", title: "Hotel B" },
				],
				required: true,
				roomNumberField: null,
			},
		}),
	);

	test("is incomplete until the question, place and room number are supplied", () => {
		expect(isActivityDetailComplete(desc, emptyActivityDraft())).toBe(false);

		const dietaryKey = desc.activityQuestions[0]?.key ?? "";
		const partial = {
			answers: { [dietaryKey]: "None" },
			dropoffPlaceId: null,
			pickupPlaceId: "10",
			roomNumber: "",
		};
		// Place 10 asks for a room number, so it is still incomplete.
		expect(isActivityDetailComplete(desc, partial)).toBe(false);

		expect(
			isActivityDetailComplete(desc, { ...partial, roomNumber: "402" }),
		).toBe(true);
	});
});

describe("buildActivityDetailInput", () => {
	test("maps answers to their groups and carries a preselected pickup place", () => {
		const desc = describeActivityBooking(
			item([{ count: 1, label: "Adult", pricingCategoryId: 1 }]),
			schema({
				activityQuestions: [field({ questionId: "dietary" })],
				passengers: [
					{
						fields: [field({ questionId: "weight" })],
						pricingCategoryId: 1,
						title: "Adult",
						type: null,
					},
				],
				pickup: {
					customerSelectable: false,
					places: [{ askForRoomNumber: false, id: "10", title: "Depot" }],
					required: true,
					roomNumberField: null,
				},
			}),
		);
		const dietaryKey = desc.activityQuestions[0]?.key ?? "";
		const weightKey = desc.passengers[0]?.questions[0]?.key ?? "";

		const result = buildActivityDetailInput("cart-item-1", desc, {
			answers: { [dietaryKey]: "Vegan", [weightKey]: "80" },
			dropoffPlaceId: null,
			pickupPlaceId: null,
			roomNumber: "",
		});

		expect(result.cartItemId).toBe("cart-item-1");
		// Preselected place rides along even though the guest was never asked.
		expect(result.pickupPlaceId).toBe("10");
		expect(result.answers).toEqual([
			{
				answer: "Vegan",
				group: "activity",
				participantIndex: null,
				questionId: "dietary",
			},
			{
				answer: "80",
				group: "passengerDetails",
				participantIndex: 0,
				questionId: "weight",
			},
		]);
	});
});
