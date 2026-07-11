import { describe, expect, it } from "bun:test";
import {
	HostkitApiError,
	HostkitClient,
	HostkitConfigurationError,
	HostkitResponseValidationError,
	HostkitTimeoutError,
} from "./index";

const API_KEY = "hostkit-secret-key";

describe("HostkitClient", () => {
	it("rejects insecure provider base URLs", () => {
		expect(
			() =>
				new HostkitClient({
					apiKey: API_KEY,
					baseUrl: "http://app.hostkit.pt/api/",
				}),
		).toThrow(HostkitConfigurationError);
	});

	it("sends the APIKEY and guest fields as query parameters", async () => {
		let capturedRequest: Request | undefined;
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async (input, init) => {
				capturedRequest = new Request(input, init);
				return Response.json({ status: "success" });
			},
			maxReadRetries: 0,
		});

		const response = await client.guests.add({
			arrival: "2026-07-10",
			birthday: "1990-12-01",
			countryResidence: "FRA",
			departure: "2026-07-15",
			documentCountry: "FRA",
			documentId: "123456789",
			documentType: "P",
			firstName: "Alana",
			lastName: "Bolsch",
			nationality: "FRA",
			rcode: "HMK71DA91ALK",
		});

		expect(response.status).toBe("success");
		const url = new URL(capturedRequest?.url ?? "");
		expect(url.pathname.endsWith("/addGuest")).toBe(true);
		expect(url.searchParams.get("APIKEY")).toBe(API_KEY);
		expect(url.searchParams.get("rcode")).toBe("HMK71DA91ALK");
		expect(url.searchParams.get("doc_type")).toBe("P");
		// Hostkit's "unknown city" convention is a dash, not an empty value.
		expect(url.searchParams.get("city_residence")).toBe("-");
	});

	it("forwards the optional uid on every call", async () => {
		let capturedRequest: Request | undefined;
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async (input, init) => {
				capturedRequest = new Request(input, init);
				return Response.json({ status: "success" });
			},
			uid: "331",
		});

		await client.siba.validate({ rcode: "ABC" });
		const url = new URL(capturedRequest?.url ?? "");
		expect(url.searchParams.get("uid")).toBe("331");
	});

	it("surfaces provider error bodies as HostkitApiError with the key redacted", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () =>
				Response.json({
					error: `Unknown reservation code (APIKEY=${API_KEY})`,
				}),
			maxReadRetries: 0,
		});

		try {
			await client.siba.validate({ rcode: "MISSING" });
			throw new Error("expected HostkitApiError");
		} catch (error) {
			expect(error).toBeInstanceOf(HostkitApiError);
			const apiError = error as HostkitApiError;
			expect(apiError.providerMessage).toContain("Unknown reservation code");
			expect(apiError.providerMessage).not.toContain(API_KEY);
			expect(apiError.retryable).toBe(false);
		}
	});

	it("treats a non-success mutation status as a provider rejection", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () => Response.json({ status: "invalid" }),
		});

		expect(client.siba.validate({ rcode: "ABC" })).rejects.toBeInstanceOf(
			HostkitApiError,
		);
	});

	it("does not status-check read endpoints", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () =>
				Response.json({ shortlink: "https://icheckin.pt/?X", status: "done" }),
		});

		const checkin = await client.guests.onlineCheckin({ rcode: "ABC" });
		expect(checkin.status).toBe("done");
	});

	it("marks rate limit provider messages as retryable", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () => Response.json({ error: "Limit exceeded" }),
			maxReadRetries: 0,
		});

		try {
			await client.guests.removeAll({ rcode: "ABC" });
			throw new Error("expected HostkitApiError");
		} catch (error) {
			expect(error).toBeInstanceOf(HostkitApiError);
			expect((error as HostkitApiError).retryable).toBe(true);
		}
	});

	it("retries retryable read failures but never mutations", async () => {
		let readCalls = 0;
		const readClient = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () => {
				readCalls += 1;
				return readCalls === 1
					? Response.json({ error: "Internal error" }, { status: 500 })
					: Response.json({ invoicing_nif: "123456789" });
			},
			maxReadRetries: 1,
			retryDelayMs: 0,
		});
		const property = await readClient.property.get();
		expect(readCalls).toBe(2);
		expect(property.invoicing_nif).toBe("123456789");

		let mutationCalls = 0;
		const mutationClient = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () => {
				mutationCalls += 1;
				return Response.json({ error: "Internal error" }, { status: 500 });
			},
			maxReadRetries: 3,
			retryDelayMs: 0,
		});
		expect(
			mutationClient.guests.removeAll({ rcode: "ABC" }),
		).rejects.toBeInstanceOf(HostkitApiError);
		expect(mutationCalls).toBe(1);
	});

	it("validates response shapes without leaking values", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async () => Response.json({ unexpected: true }),
			maxReadRetries: 0,
		});

		try {
			await client.invoicing.listReservationInvoices({ rcode: "ABC" });
			throw new Error("expected HostkitResponseValidationError");
		} catch (error) {
			expect(error).toBeInstanceOf(HostkitResponseValidationError);
			const validationError = error as HostkitResponseValidationError;
			expect(validationError.responseShape).toContain("unexpected");
			expect(validationError.responseShape).not.toContain("true");
		}
	});

	it("times out slow responses", async () => {
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
			maxReadRetries: 0,
			timeoutMs: 10,
		});

		expect(client.property.get()).rejects.toBeInstanceOf(HostkitTimeoutError);
	});

	it("maps invoice drafting calls to the documented endpoints", async () => {
		const urls: string[] = [];
		const client = new HostkitClient({
			apiKey: API_KEY,
			fetch: async (input, init) => {
				const url = new Request(input, init).url;
				urls.push(url);
				if (url.includes("addInvoiceLine")) {
					return Response.json({ line: "1", status: "success" });
				}
				if (url.includes("addInvoice")) {
					return Response.json({ id: "35", status: "success" });
				}
				return Response.json({
					invoice_url: "https://hostk.it/i/123/ABC",
					status: "success",
				});
			},
		});

		const draft = await client.invoicing.createDraft({
			country: "FRA",
			customerId: "999999990",
			name: "Alana Bolsch",
			rcode: "HMK71DA91ALK",
		});
		expect(draft.id).toBe("35");

		const line = await client.invoicing.addLine({
			customDescription: "Alojamento Local",
			discount: 0,
			id: "35",
			price: "1234.56",
			productId: "AL",
			quantity: 1,
			reasonCode: undefined,
			type: "S",
			vat: 6,
		});
		expect(line.line).toBe("1");

		const closed = await client.invoicing.close({ id: "35" });
		expect(closed.invoice_url).toBe("https://hostk.it/i/123/ABC");

		const [addUrl, lineUrl, closeUrl] = urls.map((value) => new URL(value));
		expect(addUrl?.pathname.endsWith("/addInvoice")).toBe(true);
		expect(addUrl?.searchParams.get("customer_id")).toBe("999999990");
		expect(lineUrl?.pathname.endsWith("/addInvoiceLine")).toBe(true);
		expect(lineUrl?.searchParams.get("price")).toBe("1234.56");
		expect(lineUrl?.searchParams.has("reason_code")).toBe(true);
		expect(lineUrl?.searchParams.get("reason_code")).toBe("");
		expect(closeUrl?.pathname.endsWith("/closeInvoice")).toBe(true);
	});
});
