import { describe, expect, test } from "bun:test";
import {
	type NormalizeActivityBookingSchemaInput,
	normalizeActivityBookingSchema,
} from "./booking-schema";

// Shapes captured live from the Bokun sandbox (activity 1248387 "Arouca").
const optionsResponse = {
	options: [{ type: "CUSTOMER_FULL_PAYMENT", amountMinor: 11500 }],
	questions: {
		mainContactDetails: [
			{
				questionId: "firstName",
				label: "First name",
				dataType: "SHORT_TEXT",
				required: true,
			},
			{
				questionId: "lastName",
				label: "Last name",
				dataType: "SHORT_TEXT",
				required: true,
			},
			{
				questionId: "email",
				label: "Your email address",
				dataType: "SHORT_TEXT",
				dataFormat: "EMAIL_ADDRESS",
				required: true,
			},
			{
				questionId: "phoneNumber",
				label: "Phone number",
				dataType: "SHORT_TEXT",
				dataFormat: "PHONE_NUMBER",
				required: true,
			},
			{
				questionId: "language",
				label: "Language",
				dataType: "SHORT_TEXT",
				dataFormat: "LANGUAGE",
				required: true,
				selectFromOptions: true,
				answerOptions: [
					{ value: "en", label: "English" },
					{ value: "pt", label: "Portuguese" },
				],
			},
			{
				questionId: "dateOfBirth",
				label: "Date of birth",
				dataType: "DATE",
				required: true,
			},
			{
				questionId: "nationality",
				label: "Nationality",
				dataType: "SHORT_TEXT",
				required: false,
				requiredBeforeDeparture: true,
			},
		],
		activityBookings: [
			{
				activityId: 1248387,
				questions: [
					{
						questionId: "1614075",
						label: "Do you have anyt Dietary Restrictions",
						dataType: "SHORT_TEXT",
						required: true,
					},
				],
				passengers: [
					{
						pricingCategoryId: 1216378,
						pricingCategoryTitle: "Adults",
						pricingCategoryType: "ADULT",
						passengerDetails: [
							{
								questionId: "firstName",
								label: "First name",
								dataType: "SHORT_TEXT",
								required: true,
							},
							{
								questionId: "lastName",
								label: "Last name",
								dataType: "SHORT_TEXT",
								required: true,
							},
							{
								questionId: "gender",
								label: "Gender",
								dataType: "SHORT_TEXT",
								required: true,
								selectFromOptions: true,
								answerOptions: [
									{ value: "m", label: "Male" },
									{ value: "f", label: "Female" },
								],
							},
						],
						questions: [
							{
								questionId: "1294533",
								label: "Do you have any dietary restrictions or allergies?",
								dataType: "SHORT_TEXT",
								required: false,
							},
							{
								questionId: "1294534",
								label:
									"Do you have any mobility restrictions or health problems?",
								dataType: "SHORT_TEXT",
								required: false,
							},
						],
						extras: [],
					},
				],
				pickupQuestions: [
					{
						questionId: "roomNumber",
						label: "Room number",
						dataType: "SHORT_TEXT",
						required: false,
					},
					{
						questionId: "flightNumber",
						label: "Flight number",
						dataType: "SHORT_TEXT",
						required: true,
					},
					{
						questionId: "estimatedArrival",
						label: "Estimated arrival",
						dataType: "SHORT_TEXT",
						dataFormat: "TIME",
						required: true,
					},
				],
				dropoffQuestions: [
					{
						questionId: "dropoffNote",
						label: "Drop-off details",
						dataType: "LONG_TEXT",
						required: false,
					},
				],
			},
		],
	},
} satisfies Record<string, unknown>;

const pickupPlaces = {
	pickupPlaces: [
		{
			askForRoomNumber: false,
			id: 14875488,
			title: "Airbnb",
			type: "ACCOMMODATION",
		},
	],
	dropoffPlaces: [
		{
			askForRoomNumber: false,
			id: 14875488,
			title: "Airbnb",
			type: "ACCOMMODATION",
		},
	],
};

function build(overrides: Partial<NormalizeActivityBookingSchemaInput> = {}) {
	return normalizeActivityBookingSchema({
		activityId: "1248387",
		dropoffPlaces: pickupPlaces,
		dropoffSelectionType: "PRESELECTED",
		options: optionsResponse,
		pickupPlaces,
		pickupSelectionType: "PRESELECTED",
		...overrides,
	});
}

describe("normalizeActivityBookingSchema", () => {
	test("extracts main-contact, activity and per-passenger questions", () => {
		const schema = build();

		expect(schema.mainContactFields.map((f) => f.questionId)).toEqual([
			"firstName",
			"lastName",
			"email",
			"phoneNumber",
			"language",
			"dateOfBirth",
			"nationality",
		]);
		const language = schema.mainContactFields.find(
			(f) => f.questionId === "language",
		);
		expect(language?.selectFromOptions).toBe(true);
		expect(language?.options).toEqual([
			{ label: "English", value: "en" },
			{ label: "Portuguese", value: "pt" },
		]);

		expect(schema.activityQuestions).toHaveLength(1);
		expect(schema.activityQuestions[0]?.questionId).toBe("1614075");
		expect(schema.activityQuestions[0]?.required).toBe(true);

		expect(schema.passengers).toHaveLength(1);
		expect(schema.passengers[0]?.pricingCategoryId).toBe(1216378);
		expect(schema.passengers[0]?.fields.map((f) => f.questionId)).toEqual([
			"firstName",
			"lastName",
			"gender",
		]);
		expect(schema.passengers[0]?.questions.map((f) => f.questionId)).toEqual([
			"1294533",
			"1294534",
		]);
	});

	test("PRESELECTED pickup/dropoff is required and not customer-selectable", () => {
		const schema = build();
		expect(schema.pickup).not.toBeNull();
		expect(schema.pickup?.required).toBe(true);
		expect(schema.pickup?.customerSelectable).toBe(false);
		expect(schema.pickup?.places).toEqual([
			{
				askForRoomNumber: false,
				id: "14875488",
				title: "Airbnb",
				type: "ACCOMMODATION",
			},
		]);
		expect(schema.pickup?.questions.map((field) => field.questionId)).toEqual([
			"roomNumber",
			"flightNumber",
			"estimatedArrival",
		]);
		expect(schema.pickup?.roomNumberField?.questionId).toBe("roomNumber");
		expect(schema.dropoff?.required).toBe(true);
		expect(schema.dropoff?.questions.map((field) => field.questionId)).toEqual([
			"dropoffNote",
		]);
	});

	test("SELECTED_BY_CUSTOMER pickup is customer-selectable", () => {
		const schema = build({ pickupSelectionType: "SELECTED_BY_CUSTOMER" });
		expect(schema.pickup?.customerSelectable).toBe(true);
		expect(schema.pickup?.required).toBe(true);
	});

	test("OPTIONAL pickup/dropoff is customer-selectable and not required", () => {
		const schema = build({
			dropoffSelectionType: "OPTIONAL",
			pickupSelectionType: "OPTIONAL",
		});
		expect(schema.pickup?.customerSelectable).toBe(true);
		expect(schema.pickup?.required).toBe(false);
		expect(schema.dropoff?.customerSelectable).toBe(true);
		expect(schema.dropoff?.required).toBe(false);
	});

	test("NOT_INCLUDED / absent selection type yields no pickup schema", () => {
		expect(build({ pickupSelectionType: "NOT_INCLUDED" }).pickup).toBeNull();
		expect(build({ pickupSelectionType: null }).pickup).toBeNull();
		expect(build({ dropoffSelectionType: undefined }).dropoff).toBeNull();
	});
});
