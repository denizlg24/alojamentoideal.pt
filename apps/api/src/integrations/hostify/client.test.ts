import { describe, expect, it } from "bun:test";
import {
	HostifyApiError,
	HostifyClient,
	HostifyConfigurationError,
	HostifyRequestAbortedError,
	HostifyResponseValidationError,
	HostifyTimeoutError,
} from "./index.js";

const API_KEY = "hostify-secret-key";

describe("HostifyClient", () => {
	it("rejects insecure provider base URLs", () => {
		expect(
			() =>
				new HostifyClient({
					apiKey: API_KEY,
					baseUrl: "http://api-rms.hostify.com",
				}),
		).toThrow(HostifyConfigurationError);
	});

	it("builds typed GET requests and validates the response", async () => {
		let capturedRequest: Request | undefined;
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async (input, init) => {
				capturedRequest = new Request(input, init);
				return Response.json({
					success: true,
					listings: [{ id: 42, name: "Lisbon Flat" }],
				});
			},
			maxReadRetries: 0,
		});

		const response = await client.listings.list({
			filters: [{ field: "city", operator: "=", value: "Lisbon" }],
			page: 2,
		});

		expect(response.listings[0]?.id).toBe(42);
		expect(capturedRequest?.headers.get("x-api-key")).toBe(API_KEY);

		const url = new URL(capturedRequest?.url ?? "");
		expect(url.pathname).toBe("/listings");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.get("filters")).toBe(
			JSON.stringify([{ field: "city", operator: "=", value: "Lisbon" }]),
		);
	});

	it("retries retryable GET responses", async () => {
		let calls = 0;
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async () => {
				calls += 1;
				return calls === 1
					? Response.json(
							{ error: "temporary", success: false },
							{ status: 503 },
						)
					: Response.json({ success: true, user: { id: 9 } });
			},
			maxReadRetries: 1,
			retryDelayMs: 0,
		});

		const response = await client.users.get(9);

		expect(calls).toBe(2);
		expect(response.user.id).toBe(9);
	});

	it("never retries mutation requests", async () => {
		let calls = 0;
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async () => {
				calls += 1;
				return Response.json(
					{ error: "temporary", success: false },
					{ status: 503 },
				);
			},
			maxReadRetries: 3,
			retryDelayMs: 0,
		});

		await expect(
			client.reservations.create({
				email: "guest@example.com",
				end_date: "2026-07-02",
				guests: 2,
				listing_id: 10,
				name: "Guest",
				note: "",
				pets: 0,
				phone: "+351000000000",
				skip_restrictions: false,
				source: "Direct",
				start_date: "2026-07-01",
				status: "pending",
				total_price: 100,
			}),
		).rejects.toBeInstanceOf(HostifyApiError);
		expect(calls).toBe(1);
	});

	it("rejects malformed endpoint responses", async () => {
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async () =>
				Response.json({ listing: { name: "Missing id" }, success: true }),
			maxReadRetries: 0,
		});

		await expect(client.listings.get(1)).rejects.toBeInstanceOf(
			HostifyResponseValidationError,
		);
	});

	it("normalizes and redacts provider errors", async () => {
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async () =>
				Response.json(
					{ error: `Invalid x-api-key: ${API_KEY}`, success: false },
					{ status: 401 },
				),
			maxReadRetries: 0,
		});

		try {
			await client.listings.get(1);
			throw new Error("Expected request to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HostifyApiError);
			expect((error as HostifyApiError).providerMessage).not.toContain(API_KEY);
			expect((error as HostifyApiError).providerMessage).toContain(
				"[REDACTED]",
			);
		}
	});

	it("times out bounded requests", async () => {
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
			maxReadRetries: 0,
			timeoutMs: 1,
		});

		await expect(client.listings.get(1)).rejects.toBeInstanceOf(
			HostifyTimeoutError,
		);
	});

	it("does not retry caller-aborted requests", async () => {
		let calls = 0;
		const controller = new AbortController();
		controller.abort();
		const client = new HostifyClient({
			apiKey: API_KEY,
			fetch: async (_input, init) => {
				calls += 1;
				if (init?.signal?.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}
				return Response.json({ success: true, user: { id: 1 } });
			},
			maxReadRetries: 3,
			retryDelayMs: 0,
		});

		await expect(
			client.users.get(1, { signal: controller.signal }),
		).rejects.toBeInstanceOf(HostifyRequestAbortedError);
		expect(calls).toBe(1);
	});
});
