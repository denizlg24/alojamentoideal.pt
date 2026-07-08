import { describe, expect, test } from "bun:test";
import { BokunApiError, type BokunClient } from "../integrations/bokun";
import {
	HostifyApiError,
	type HostifyClient,
	HostifyResponseValidationError,
} from "../integrations/hostify";
import {
	type BokunActivityHoldRequest,
	BokunReservationGateway,
	type BuildReservationInput,
	buildBokunActivityCheckoutRequest,
	buildCreateReservationInput,
	buildTransactionInput,
	type HostifyHoldRequest,
	HostifyReservationGateway,
	reservationTag,
} from "./reservations";

const baseInput: BuildReservationInput = {
	charges: [
		{ grossMinor: 30_000, kind: "accommodation", taxMinor: 0 },
		{ grossMinor: 5_000, kind: "fee", taxMinor: 0 },
		{ grossMinor: 2_300, kind: "tax", taxMinor: 2_300 },
	],
	chargeDate: "2026-06-25",
	contact: {
		email: "guest@example.com",
		name: "Ada Lovelace",
		phone: "+351910000000",
	},
	currency: "EUR",
	detail: {
		checkIn: "2026-07-01",
		checkOut: "2026-07-05",
		guests: 2,
		hostifyListingId: "1234",
		pets: 0,
	},
	itemTotalMinor: 37_300,
	orderItemId: "item-1",
	publicReference: "AI-2026-ABCD1234",
	source: "alojamentoideal",
};

describe("buildCreateReservationInput", () => {
	test("maps money to major units and tags the note", () => {
		const result = buildCreateReservationInput(baseInput);
		expect(result.status).toBe("pending");
		expect(result.skip_restrictions).toBe(false);
		expect(result.total_price).toBe(373);
		expect(result.base_price).toBe(300);
		expect(result.tax_amount).toBe(23);
		expect(result.start_date).toBe("2026-07-01");
		expect(result.end_date).toBe("2026-07-05");
		expect(result.note).toContain(reservationTag("AI-2026-ABCD1234", "item-1"));
	});
});

describe("buildTransactionInput", () => {
	test("builds an incomplete accommodation transaction", () => {
		const result = buildTransactionInput(baseInput);
		expect(result.amount).toBe(373);
		expect(result.currency).toBe("EUR");
		expect(result.is_completed).toBe(0);
		expect(result.type).toBe("accommodation");
		expect(result.arrival_date).toBe("2026-07-01");
		expect(result.charge_date).toBe("2026-06-25");
		expect(result.details).toContain(
			reservationTag("AI-2026-ABCD1234", "item-1"),
		);
	});
});

describe("buildBokunActivityCheckoutRequest", () => {
	test("maps an activity hold to Bokun direct external-payment checkout", () => {
		const result = buildBokunActivityCheckoutRequest(activityHoldRequest);
		expect(result.amount).toBe(50);
		expect(result.paymentMethod).toBe("RESERVE_FOR_EXTERNAL_PAYMENT");
		expect(result.source).toBe("DIRECT_REQUEST");

		const directBooking = result.directBooking as Record<string, unknown>;
		expect(directBooking.externalBookingReference).toBe(
			reservationTag("AI-2026-ACT1234", "item-activity"),
		);

		const [activity] = directBooking.activityBookings as Record<
			string,
			unknown
		>[];
		expect(activity?.activityId).toBe(12345);
		expect(activity?.rateId).toBe(7);
		expect(activity?.startTimeId).toBe(9);
		expect(activity?.answers).toEqual([
			{ questionId: "allergies", values: ["No allergies"] },
		]);
		expect(activity?.passengers).toEqual([
			{
				answers: [],
				extras: [],
				groupSize: 1,
				passengerDetails: [
					{ questionId: "fullName", values: ["Ada Lovelace"] },
				],
				pricingCategoryId: 10,
			},
			{
				answers: [],
				extras: [],
				groupSize: 1,
				passengerDetails: [],
				pricingCategoryId: 10,
			},
		]);
	});

	test("emits pickup/dropoff places, passenger details and full main contact", () => {
		const result = buildBokunActivityCheckoutRequest({
			activity: {
				activityDate: "2026-07-13",
				answers: [
					{
						answer: "None",
						group: "activity",
						participantIndex: null,
						questionId: "1614075",
					},
					{
						answer: "Ana",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "firstName",
					},
					{
						answer: "Silva",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "lastName",
					},
					{
						answer: "m",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "gender",
					},
				],
				bokunActivityId: "1248387",
				dropoffPlaceId: "14875488",
				participants: [
					{
						count: 1,
						label: "Adult",
						pricingCategoryId: 1216378,
						subtotalMinor: 11500,
						unitPriceMinor: 11500,
					},
				],
				pickupPlaceId: "14875488",
				rateId: "2480652",
				roomNumber: "12",
				startTimeId: "5455452",
			},
			amountMinor: 11500,
			contact: {
				dateOfBirth: "1990-05-15",
				email: "ana@example.com",
				firstName: "Ana",
				language: "en",
				lastName: "Silva",
				name: "Ana Silva",
				phone: "+351910000000",
			},
			currency: "EUR",
			kind: "bokun_activity",
			orderItemId: "item-activity",
			publicReference: "AI-2026-ACT1234",
			source: "alojamentoideal",
		});

		const directBooking = result.directBooking as Record<string, unknown>;
		const [activity] = directBooking.activityBookings as Record<
			string,
			unknown
		>[];
		expect(activity?.pickup).toBe(true);
		expect(activity?.pickupPlaceId).toBe(14875488);
		expect(activity?.dropoff).toBe(true);
		expect(activity?.dropoffPlaceId).toBe(14875488);
		expect(activity?.pickupAnswers).toEqual([
			{ questionId: "roomNumber", values: ["12"] },
		]);
		expect(activity?.passengers).toEqual([
			{
				answers: [],
				extras: [],
				groupSize: 1,
				passengerDetails: [
					{ questionId: "firstName", values: ["Ana"] },
					{ questionId: "lastName", values: ["Silva"] },
					{ questionId: "gender", values: ["m"] },
				],
				pricingCategoryId: 1216378,
			},
		]);
		expect(directBooking.mainContactDetails).toEqual([
			{ questionId: "firstName", values: ["Ana"] },
			{ questionId: "lastName", values: ["Silva"] },
			{ questionId: "email", values: ["ana@example.com"] },
			{ questionId: "phoneNumber", values: ["+351910000000"] },
			{ questionId: "language", values: ["en"] },
			{ questionId: "dateOfBirth", values: ["1990-05-15"] },
		]);
	});

	test("falls back to first passenger language and date of birth for main contact", () => {
		const result = buildBokunActivityCheckoutRequest({
			activity: {
				activityDate: "2026-07-13",
				answers: [
					{
						answer: "Ana",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "firstName",
					},
					{
						answer: "Silva",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "lastName",
					},
					{
						answer: "pt",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "language",
					},
					{
						answer: "1990-05-15",
						group: "passengerDetails",
						participantIndex: 0,
						questionId: "dateOfBirth",
					},
				],
				bokunActivityId: "1248387",
				participants: [
					{
						count: 1,
						label: "Adult",
						pricingCategoryId: 1216378,
						subtotalMinor: 11500,
						unitPriceMinor: 11500,
					},
				],
				rateId: "2480652",
				startTimeId: "5455452",
			},
			amountMinor: 11500,
			contact: {
				email: "booker@example.com",
				name: "Ana",
				phone: "+351910000000",
			},
			currency: "EUR",
			kind: "bokun_activity",
			orderItemId: "item-activity",
			publicReference: "AI-2026-ACT1234",
			source: "alojamentoideal",
		});

		const directBooking = result.directBooking as Record<string, unknown>;
		expect(directBooking.mainContactDetails).toEqual([
			{ questionId: "firstName", values: ["Ana"] },
			{ questionId: "lastName", values: ["Silva"] },
			{ questionId: "email", values: ["booker@example.com"] },
			{ questionId: "phoneNumber", values: ["+351910000000"] },
			{ questionId: "language", values: ["pt"] },
			{ questionId: "dateOfBirth", values: ["1990-05-15"] },
		]);
	});
});

interface Calls {
	reservationCreate: unknown[];
	reservationList: unknown[];
	reservationUpdate: {
		id: string;
		input: { notes?: string; status?: string };
	}[];
	transactionCreate: { reservation_id: string | number }[];
	transactionList: { reservation_id?: string | number }[];
	transactionUpdate: { id: string; input: { is_completed?: number } }[];
}

function fakeClient(overrides: {
	reservationCreate?: () => unknown;
	reservationGet?: () => unknown;
	reservationUpdate?: () => unknown;
	reservationsList?: (query: unknown) => unknown;
	transactionsList?: () => unknown;
}): { calls: Calls; client: HostifyClient } {
	const calls: Calls = {
		reservationCreate: [],
		reservationList: [],
		reservationUpdate: [],
		transactionCreate: [],
		transactionList: [],
		transactionUpdate: [],
	};
	const client = {
		reservations: {
			create: async (input: unknown) => {
				calls.reservationCreate.push(input);
				return (
					overrides.reservationCreate?.() ?? {
						reservation: { id: 999, notes: null, status: "pending" },
						success: true,
					}
				);
			},
			get: async () =>
				overrides.reservationGet?.() ?? {
					reservation: { id: 999, status: "pending" },
					success: true,
				},
			list: async (query: unknown) => {
				calls.reservationList.push(query);
				return (
					overrides.reservationsList?.(query) ?? {
						reservations: [],
						success: true,
					}
				);
			},
			update: async (
				id: string,
				input: { notes?: string; status?: string },
			) => {
				calls.reservationUpdate.push({ id, input });
				return (
					overrides.reservationUpdate?.() ?? {
						success: true,
						update_data: { status: input.status ?? "pending" },
					}
				);
			},
		},
		transactions: {
			create: async (input: { reservation_id: string | number }) => {
				calls.transactionCreate.push(input);
				return { success: true, transaction: { id: 555 } };
			},
			list: async (query: { reservation_id?: string | number }) => {
				calls.transactionList.push(query);
				return (
					overrides.transactionsList?.() ?? { success: true, transaction: [] }
				);
			},
			update: async (id: string, input: { is_completed?: number }) => {
				calls.transactionUpdate.push({ id, input });
				return { success: true, transaction: { id } };
			},
		},
	} as unknown as HostifyClient;
	return { calls, client };
}

const holdRequest: HostifyHoldRequest = {
	reservation: buildCreateReservationInput(baseInput),
	transaction: buildTransactionInput(baseInput),
};

const activityHoldRequest = {
	activity: {
		activityDate: "2026-08-01",
		answers: [
			{
				answer: "No allergies",
				group: "activity",
				participantIndex: null,
				questionId: "allergies",
			},
			{
				answer: "Ada Lovelace",
				group: "passengerDetails",
				participantIndex: 0,
				questionId: "fullName",
			},
		],
		bokunActivityId: "12345",
		participants: [
			{
				count: 2,
				label: "Adult",
				pricingCategoryId: 10,
				subtotalMinor: 5000,
				unitPriceMinor: 2500,
			},
		],
		rateId: "7",
		startTimeId: "9",
	},
	amountMinor: 5000,
	contact: {
		email: "guest@example.com",
		name: "Ada Lovelace",
		phone: "+351910000000",
	},
	currency: "EUR",
	kind: "bokun_activity",
	orderItemId: "item-activity",
	publicReference: "AI-2026-ACT1234",
	source: "alojamentoideal",
} satisfies BokunActivityHoldRequest;

describe("HostifyReservationGateway.placeHold", () => {
	test("creates the reservation then the linked transaction", async () => {
		const { calls, client } = fakeClient({});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.placeHold(holdRequest);

		expect(result.kind).toBe("created");
		if (result.kind !== "created") return;
		expect(result.reservationId).toBe("999");
		expect(result.transactionId).toBe("555");
		expect(calls.transactionCreate[0]?.reservation_id).toBe("999");
	});

	test("a 409 maps to unavailable (dates blocked, no charge)", async () => {
		const { client } = fakeClient({
			reservationCreate: () => {
				throw new HostifyApiError("conflict", 409, {
					providerMessage: "Not available",
				});
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.placeHold(holdRequest);
		expect(result.kind).toBe("unavailable");
	});

	test("a 503 maps to transient", async () => {
		const { client } = fakeClient({
			reservationCreate: () => {
				throw new HostifyApiError("unavailable", 503);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.placeHold(holdRequest);
		expect(result.kind).toBe("transient");
	});

	test("a 400 maps to permanent", async () => {
		const { client } = fakeClient({
			reservationCreate: () => {
				throw new HostifyApiError("bad request", 400);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.placeHold(holdRequest);
		expect(result.kind).toBe("permanent");
	});
});

describe("HostifyReservationGateway.confirmHold", () => {
	test("accepts the reservation and completes the transaction", async () => {
		const { calls, client } = fakeClient({
			// The confirm is classified against a live re-read, not the PUT echo.
			reservationGet: () => ({
				reservation: { id: 999, status: "accepted" },
				success: true,
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("ok");
		expect(calls.reservationUpdate[0]?.input.status).toBe("accepted");
		expect(calls.transactionUpdate[0]?.input.is_completed).toBe(1);
	});

	test("a PUT that echoes accepted but stays pending is not_settled", async () => {
		// Hostify can return `accepted` on the PUT yet leave a far-future
		// reservation `pending`. The re-read is authoritative and must not confirm.
		const { calls, client } = fakeClient({
			reservationGet: () => ({
				reservation: { id: 999, status: "pending" },
				success: true,
			}),
			reservationUpdate: () => ({
				success: true,
				update_data: { status: "accepted" },
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("not_settled");
		expect(calls.reservationUpdate[0]?.input.status).toBe("accepted");
	});

	test("a hold that died (denied) is permanent, not a false confirm", async () => {
		const { client } = fakeClient({
			reservationGet: () => ({
				reservation: { id: 999, status: "denied" },
				success: true,
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("permanent");
	});

	test("a failed PUT whose re-read still shows pending is not_settled", async () => {
		// The PUT errored but the hold is alive and pending: keep retrying without
		// ever escalating to a refund.
		const { client } = fakeClient({
			reservationGet: () => ({
				reservation: { id: 999, status: "pending" },
				success: true,
			}),
			reservationUpdate: () => {
				throw new HostifyApiError("conflict", 409);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("not_settled");
	});

	test("a failed PUT whose re-read also fails is transient", async () => {
		const { client } = fakeClient({
			reservationGet: () => {
				throw new HostifyApiError("unavailable", 503);
			},
			reservationUpdate: () => {
				throw new HostifyApiError("unavailable", 503);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("transient");
	});

	test("a retryable re-read failure stays transient even when the PUT failure is permanent", async () => {
		const { client } = fakeClient({
			reservationGet: () => {
				throw new HostifyApiError("unavailable", 503);
			},
			reservationUpdate: () => {
				throw new HostifyApiError("conflict", 409);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("transient");
		if (result.kind !== "transient") return;
		expect(result.code).toBe("confirm_status_unknown_http_503");
		expect(result.message).toContain("reservation status is unknown");
	});

	test("treats an already-accepted reservation as success on error", async () => {
		const { calls, client } = fakeClient({
			reservationUpdate: () => {
				throw new HostifyApiError("conflict", 409);
			},
			reservationGet: () => ({
				reservation: { id: 999, status: "accepted" },
				success: true,
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});
		expect(result.kind).toBe("ok");
		expect(calls.transactionUpdate[0]?.input.is_completed).toBe(1);
	});

	test("an unparseable PUT whose re-read shows pending is not_settled", async () => {
		const { client } = fakeClient({
			reservationGet: () => ({
				reservation: { id: 999, status: "pending" },
				success: true,
			}),
			reservationUpdate: () => {
				throw new HostifyResponseValidationError("schema drift");
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "999",
			transactionId: "555",
		});
		// The live re-read resolves the ambiguity: the hold is alive and pending, so
		// this must not hard-fail into compensation/refund.
		expect(result.kind).toBe("not_settled");
	});
});

describe("HostifyReservationGateway.cancelHold", () => {
	test("cancels the reservation and voids the transaction", async () => {
		const { calls, client } = fakeClient({});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.cancelHold({
			reason: "checkout_expired",
			reservationId: "999",
			transactionId: "555",
		});

		expect(result.kind).toBe("ok");
		expect(calls.reservationUpdate[0]?.input.status).toBe("cancelled_by_host");
		expect(calls.reservationUpdate[0]?.input.notes).toBe("checkout_expired");
		expect(calls.transactionUpdate[0]?.input.is_completed).toBe(0);
	});
});

describe("HostifyReservationGateway.findExistingHold", () => {
	test("adopts a tagged reservation matching the dates", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { calls, client } = fakeClient({
			reservationsList: () => ({
				reservations: [
					{ id: 1, notes: "unrelated", status: "pending" },
					{ id: 2, notes: `held [${tag}]`, status: "pending" },
				],
				success: true,
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag,
		});
		expect(result?.reservationId).toBe("2");
		expect(calls.reservationList[0]).toMatchObject({
			page: 1,
			per_page: 50,
		});
	});

	test("continues scanning reservation pages until it finds a tagged hold", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { calls, client } = fakeClient({
			reservationsList: (query) => {
				const page =
					typeof query === "object" && query !== null && "page" in query
						? (query as { page?: number }).page
						: undefined;
				return {
					reservations:
						page === 1
							? Array.from({ length: 50 }, (_, index) => ({
									id: index + 1,
									notes: "unrelated",
									status: "pending",
								}))
							: [{ id: 99, notes: `held [${tag}]`, status: "pending" }],
					success: true,
				};
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag,
		});
		expect(result?.reservationId).toBe("99");
		expect(calls.reservationList).toHaveLength(2);
		expect(calls.reservationList[1]).toMatchObject({ page: 2 });
	});

	test("recovers the transaction id when adopting a tagged reservation", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { calls, client } = fakeClient({
			reservationsList: () => ({
				reservations: [{ id: 2, notes: `held [${tag}]`, status: "pending" }],
				success: true,
			}),
			transactionsList: () => ({
				success: true,
				transaction: [
					{ details: "unrelated", id: 111 },
					{ details: `Alojamento Ideal [${tag}]`, id: 777 },
				],
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag,
		});
		expect(calls.transactionList[0]?.reservation_id).toBe("2");
		expect(result?.transactionId).toBe("777");
	});

	test("does not recover an arbitrary transaction when the tag is absent", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { client } = fakeClient({
			reservationsList: () => ({
				reservations: [{ id: 2, notes: `held [${tag}]`, status: "pending" }],
				success: true,
			}),
			transactionsList: () => ({
				success: true,
				transaction: [
					{ details: "Released: checkout_expired", id: 111 },
					{ details: "Stripe completed payment_id: pi_123", id: 777 },
				],
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag,
		});
		expect(result?.transactionId).toBeNull();
	});

	test("does not adopt a tagged terminal reservation", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { client } = fakeClient({
			reservationsList: () => ({
				reservations: [
					{ id: 2, notes: `released [${tag}]`, status: "cancelled_by_host" },
				],
				success: true,
			}),
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag,
		});
		expect(result).toBeNull();
	});

	test("returns null for transient reservation list failures", async () => {
		const { client } = fakeClient({
			reservationsList: () => {
				throw new HostifyApiError("temporary", 503);
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		const result = await gateway.findExistingHold({
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "1234",
			tag: reservationTag("AI-2026-ABCD1234", "item-1"),
		});
		expect(result).toBeNull();
	});

	test("surfaces permanent reservation list failures", async () => {
		const { client } = fakeClient({
			reservationsList: () => {
				throw new HostifyResponseValidationError("schema drift");
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		await expect(
			gateway.findExistingHold({
				checkIn: "2026-07-01",
				checkOut: "2026-07-05",
				listingId: "1234",
				tag: reservationTag("AI-2026-ABCD1234", "item-1"),
			}),
		).rejects.toThrow(HostifyResponseValidationError);
	});

	test("surfaces permanent transaction lookup failures", async () => {
		const tag = reservationTag("AI-2026-ABCD1234", "item-1");
		const { client } = fakeClient({
			reservationsList: () => ({
				reservations: [{ id: 2, notes: `held [${tag}]`, status: "pending" }],
				success: true,
			}),
			transactionsList: () => {
				throw new HostifyResponseValidationError("schema drift");
			},
		});
		const gateway = new HostifyReservationGateway({ client });
		await expect(
			gateway.findExistingHold({
				checkIn: "2026-07-01",
				checkOut: "2026-07-05",
				listingId: "1234",
				tag,
			}),
		).rejects.toThrow(HostifyResponseValidationError);
	});
});

interface BokunCalls {
	abortReserved: { code: string }[];
	confirmReserved: { body: unknown; code: string }[];
	getByConfirmationCode: { code: string }[];
	submit: { body: unknown; query: unknown }[];
}

function fakeBokunClient(overrides: {
	abortReserved?: () => unknown;
	confirmReserved?: () => unknown;
	getByConfirmationCode?: () => unknown;
	submit?: () => unknown;
}): { calls: BokunCalls; client: BokunClient } {
	const calls: BokunCalls = {
		abortReserved: [],
		confirmReserved: [],
		getByConfirmationCode: [],
		submit: [],
	};
	const client = {
		v1: {
			booking: {
				abortReserved: async (code: string) => {
					calls.abortReserved.push({ code });
					return overrides.abortReserved?.() ?? { message: "aborted" };
				},
				getByConfirmationCode: async (code: string) => {
					calls.getByConfirmationCode.push({ code });
					return overrides.getByConfirmationCode?.() ?? { status: "RESERVED" };
				},
			},
			checkout: {
				confirmReserved: async (code: string, body: unknown) => {
					calls.confirmReserved.push({ body, code });
					return (
						overrides.confirmReserved?.() ?? {
							booking: { confirmationCode: code, status: "CONFIRMED" },
							success: true,
						}
					);
				},
				submit: async (body: unknown, query: unknown) => {
					calls.submit.push({ body, query });
					return (
						overrides.submit?.() ?? {
							booking: {
								activityBookings: [{ productConfirmationCode: "ACT-1" }],
								confirmationCode: "BOOK-1",
								status: "RESERVED",
							},
							confirmationCode: "BOOK-1",
							success: true,
						}
					);
				},
			},
		},
	} as unknown as BokunClient;
	return { calls, client };
}

describe("BokunReservationGateway.placeHold", () => {
	test("submits an external-payment activity checkout and stores returned codes", async () => {
		const { calls, client } = fakeBokunClient({});
		const gateway = new BokunReservationGateway({ client, lang: "en" });

		const result = await gateway.placeHold(activityHoldRequest);

		expect(result.kind).toBe("created");
		if (result.kind !== "created") return;
		expect(result.reservationId).toBe("BOOK-1");
		expect(result.transactionId).toBe("ACT-1");
		expect(result.providerStatus).toBe("RESERVED");
		expect(calls.submit[0]?.query).toEqual({ lang: "en" });
		expect(calls.submit[0]?.body).toMatchObject({
			paymentMethod: "RESERVE_FOR_EXTERNAL_PAYMENT",
			source: "DIRECT_REQUEST",
		});
	});

	test("maps a 422 submit failure to unavailable", async () => {
		const { client } = fakeBokunClient({
			submit: () => {
				throw new BokunApiError("not available", 422, {
					providerMessage: "Sold out",
				});
			},
		});
		const gateway = new BokunReservationGateway({ client });

		const result = await gateway.placeHold(activityHoldRequest);

		expect(result.kind).toBe("unavailable");
	});
});

describe("BokunReservationGateway.confirmHold", () => {
	test("confirms a reserved booking with Stripe transaction details", async () => {
		const { calls, client } = fakeBokunClient({});
		const gateway = new BokunReservationGateway({ client });

		const result = await gateway.confirmHold({
			amountMinor: 5000,
			currency: "EUR",
			paymentReference: "pi_123",
			publicReference: "AI-2026-ACT1234",
			reservationId: "BOOK-1",
			transactionId: "ACT-1",
		});

		expect(result.kind).toBe("ok");
		expect(calls.confirmReserved[0]?.code).toBe("BOOK-1");
		expect(calls.confirmReserved[0]?.body).toMatchObject({
			amount: 50,
			currency: "EUR",
			transactionDetails: { transactionId: "pi_123" },
		});
	});

	test("keeps a live reserved booking pending when confirm fails", async () => {
		const { client } = fakeBokunClient({
			confirmReserved: () => {
				throw new BokunApiError("conflict", 409);
			},
			getByConfirmationCode: () => ({
				confirmationCode: "BOOK-1",
				status: "RESERVED",
			}),
		});
		const gateway = new BokunReservationGateway({ client });

		const result = await gateway.confirmHold({
			paymentReference: "pi_123",
			reservationId: "BOOK-1",
			transactionId: "ACT-1",
		});

		expect(result.kind).toBe("not_settled");
	});
});

describe("BokunReservationGateway.cancelHold", () => {
	test("aborts a reserved booking", async () => {
		const { calls, client } = fakeBokunClient({});
		const gateway = new BokunReservationGateway({ client });

		const result = await gateway.cancelHold({
			reason: "checkout_expired",
			reservationId: "BOOK-1",
			transactionId: "ACT-1",
		});

		expect(result.kind).toBe("ok");
		expect(calls.abortReserved[0]?.code).toBe("BOOK-1");
	});

	test("keeps retrying when abort fails and the booking is still reserved", async () => {
		const { client } = fakeBokunClient({
			abortReserved: () => {
				throw new BokunApiError("conflict", 409);
			},
			getByConfirmationCode: () => ({
				confirmationCode: "BOOK-1",
				status: "RESERVED",
			}),
		});
		const gateway = new BokunReservationGateway({ client });

		const result = await gateway.cancelHold({
			reason: "checkout_expired",
			reservationId: "BOOK-1",
			transactionId: "ACT-1",
		});

		expect(result.kind).toBe("transient");
		if (result.kind !== "transient") return;
		expect(result.code).toBe("cancel_not_settled");
	});
});
