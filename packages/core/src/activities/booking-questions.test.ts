import { describe, expect, test } from "bun:test";
import {
	applyBookingQuestionAnswers,
	buildBookingQuestionsAnswerBody,
	normalizeActivityBookingQuestions,
	summarizeBookingQuestionsCompleteness,
} from "./booking-questions";

const question = (
	questionId: string,
	overrides: Record<string, unknown> = {},
) => ({
	answerOptions: [],
	answers: [],
	dataFormat: null,
	dataType: "SHORT_TEXT",
	label: questionId,
	required: false,
	selectFromOptions: false,
	selectMultiple: false,
	questionId,
	...overrides,
});

const payload = {
	activityBookings: [
		{
			activityId: 4242,
			activityTitle: "Douro Valley Tour",
			bookingId: 9001,
			passengers: [
				{
					bookingId: 9002,
					passengerDetails: [
						question("firstName", { answers: ["Ana"], required: true }),
					],
					pricingCategoryId: 77,
					pricingCategoryTitle: "Adult",
					questions: [question("dietary")],
				},
			],
			pickupQuestions: [question("roomNumber")],
			questions: [
				question("arrivalTime", { required: true }),
				question("notes", { answers: ["  "] }),
			],
		},
	],
	mainContactDetails: [
		question("email", {
			answers: ["ana@example.com"],
			dataFormat: "EMAIL_ADDRESS",
			required: true,
		}),
	],
};

describe("normalizeActivityBookingQuestions", () => {
	test("parses groups, answers and passenger metadata", () => {
		const snapshot = normalizeActivityBookingQuestions(payload);
		expect(snapshot.mainContactDetails).toHaveLength(1);
		expect(snapshot.mainContactDetails[0]?.answers).toEqual([
			"ana@example.com",
		]);
		const booking = snapshot.activityBookings[0];
		expect(booking?.bookingId).toBe("9001");
		expect(booking?.activityId).toBe("4242");
		expect(booking?.title).toBe("Douro Valley Tour");
		expect(booking?.questions.map((entry) => entry.questionId)).toEqual([
			"arrivalTime",
			"notes",
		]);
		expect(booking?.pickupQuestions).toHaveLength(1);
		const passenger = booking?.passengers[0];
		expect(passenger?.bookingId).toBe("9002");
		expect(passenger?.pricingCategoryId).toBe(77);
		expect(passenger?.passengerDetails[0]?.answers).toEqual(["Ana"]);
	});

	test("tolerates a malformed payload", () => {
		expect(normalizeActivityBookingQuestions(null)).toEqual({
			activityBookings: [],
			mainContactDetails: [],
		});
		expect(
			normalizeActivityBookingQuestions({ activityBookings: "x" }),
		).toEqual({ activityBookings: [], mainContactDetails: [] });
	});
});

describe("summarizeBookingQuestionsCompleteness", () => {
	test("counts blank answers by requiredness, treating whitespace as blank", () => {
		const snapshot = normalizeActivityBookingQuestions(payload);
		// Missing required: arrivalTime. Missing optional: notes (whitespace),
		// roomNumber, dietary.
		expect(summarizeBookingQuestionsCompleteness(snapshot)).toEqual({
			missingOptional: 3,
			missingRequired: 1,
		});
	});
});

describe("applyBookingQuestionAnswers", () => {
	test("applies updates to the right group and passenger", () => {
		const snapshot = normalizeActivityBookingQuestions(payload);
		const updated = applyBookingQuestionAnswers(snapshot, [
			{ group: "activity", questionId: "arrivalTime", values: ["09:30"] },
			{
				group: "passengerQuestions",
				passengerBookingId: "9002",
				questionId: "dietary",
				values: ["vegetarian"],
			},
			// Clearing an existing answer with a blank value.
			{ group: "mainContact", questionId: "email", values: ["  "] },
		]);
		const booking = updated.activityBookings[0];
		expect(
			booking?.questions.find((entry) => entry.questionId === "arrivalTime")
				?.answers,
		).toEqual(["09:30"]);
		expect(booking?.passengers[0]?.questions[0]?.answers).toEqual([
			"vegetarian",
		]);
		expect(updated.mainContactDetails[0]?.answers).toEqual([]);
		// The original snapshot is untouched.
		expect(snapshot.activityBookings[0]?.questions[0]?.answers).toEqual([]);
	});

	test("ignores unknown question ids and mismatched passengers", () => {
		const snapshot = normalizeActivityBookingQuestions(payload);
		const updated = applyBookingQuestionAnswers(snapshot, [
			{ group: "activity", questionId: "unknown", values: ["x"] },
			{
				group: "passengerQuestions",
				passengerBookingId: "9999",
				questionId: "dietary",
				values: ["x"],
			},
		]);
		expect(
			updated.activityBookings[0]?.passengers[0]?.questions[0]?.answers,
		).toEqual([]);
	});
});

describe("buildBookingQuestionsAnswerBody", () => {
	test("serializes answered questions into the provider DTO with numeric ids", () => {
		const snapshot = applyBookingQuestionAnswers(
			normalizeActivityBookingQuestions(payload),
			[{ group: "activity", questionId: "arrivalTime", values: ["09:30"] }],
		);
		const body = buildBookingQuestionsAnswerBody(snapshot);
		expect(body).toEqual({
			activityBookings: [
				{
					activityId: 4242,
					answers: [{ questionId: "arrivalTime", values: ["09:30"] }],
					bookingId: 9001,
					passengers: [
						{
							answers: [],
							bookingId: 9002,
							passengerDetails: [{ questionId: "firstName", values: ["Ana"] }],
							pricingCategoryId: 77,
						},
					],
					pickupAnswers: [],
				},
			],
			mainContactDetails: [
				{ questionId: "email", values: ["ana@example.com"] },
			],
		});
	});
});
