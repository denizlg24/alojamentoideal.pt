import { describe, expect, test } from "bun:test";
import {
	HostifyApiError,
	type HostifyClient,
	HostifyResponseValidationError,
} from "../integrations/hostify";
import {
	type BuildReservationInput,
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
						reservation: { id, status: input.status ?? "pending" },
						success: true,
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
		const { calls, client } = fakeClient({});
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

	test("treats an already-accepted reservation as success on error", async () => {
		const { client } = fakeClient({
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
