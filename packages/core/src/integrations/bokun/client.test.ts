import { describe, expect, it } from "bun:test";
import {
	BokunApiError,
	BokunClient,
	BokunConfigurationError,
	BokunRequestAbortedError,
	BokunResponseValidationError,
} from "./index";

const ACCESS_KEY = "bokun-access-key";
const SECRET_KEY = "bokun-secret-key";
const FIXED_DATE = new Date(Date.UTC(2026, 5, 17, 9, 4, 5));

type FetchImpl = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function clientWith(fetchImpl: FetchImpl) {
	return makeClient(fetchImpl);
}

function makeClient(
	fetchImpl: FetchImpl,
	overrides: Partial<{ maxReadRetries: number }> = {},
) {
	return new BokunClient({
		accessKey: ACCESS_KEY,
		fetch: fetchImpl,
		maxReadRetries: overrides.maxReadRetries ?? 0,
		now: () => FIXED_DATE,
		secretKey: SECRET_KEY,
	});
}

describe("BokunClient", () => {
	it("rejects insecure provider base URLs", () => {
		expect(
			() =>
				new BokunClient({
					accessKey: ACCESS_KEY,
					baseUrl: "http://api.bokun.io",
					secretKey: SECRET_KEY,
				}),
		).toThrow(BokunConfigurationError);
	});

	it("requires both keys", () => {
		expect(
			() => new BokunClient({ accessKey: "", secretKey: SECRET_KEY }),
		).toThrow(BokunConfigurationError);
	});

	it("signs GET requests and validates the response", async () => {
		let captured: Request | undefined;
		const client = clientWith(async (input, init) => {
			captured = new Request(input, init);
			return Response.json({ id: 42, title: "Lisbon Flat", slug: "lisbon" });
		});

		const accommodation = await client.v1.accommodation.get(42, { lang: "EN" });

		expect(accommodation.id).toBe(42);
		expect(captured?.url).toContain("/accommodation.json/42?lang=EN");
		expect(captured?.headers.get("X-Bokun-AccessKey")).toBe(ACCESS_KEY);
		expect(captured?.headers.get("X-Bokun-Date")).toBe("2026-06-17 09:04:05");
		expect(captured?.headers.get("X-Bokun-Signature")).toBeTruthy();
		expect(captured?.headers.get("X-Bokun-Signature")).not.toContain(
			SECRET_KEY,
		);
	});

	it("serializes pagination query params for v2 list endpoints", async () => {
		let captured: Request | undefined;
		const client = clientWith(async (input, init) => {
			captured = new Request(input, init);
			return Response.json({ items: [{ id: 1, title: "Standard" }] });
		});

		const result = await client.v2.pricing.getPricingCategories({
			pageNo: 2,
			pageSize: 50,
		});

		expect(result.items[0]?.title).toBe("Standard");
		expect(captured?.url).toContain("pageNo=2");
		expect(captured?.url).toContain("pageSize=50");
	});

	it("maps v2 StandardErrorDto failures to BokunApiError", async () => {
		const client = clientWith(
			async () =>
				new Response(JSON.stringify({ error: "Forbidden" }), {
					headers: { "content-type": "application/json" },
					status: 403,
				}),
		);

		const error = await client.v2.pricing
			.getTax(7)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(BokunApiError);
		expect((error as BokunApiError).status).toBe(403);
		expect((error as BokunApiError).providerMessage).toBe("Forbidden");
	});

	it("returns raw text for ticket endpoints", async () => {
		const client = clientWith(
			async () => new Response("<html>ticket</html>", { status: 200 }),
		);

		const ticket = await client.v1.booking.getActivityTicket("ABC123");
		expect(ticket).toBe("<html>ticket</html>");
	});

	it("retries idempotent GETs on retryable status codes", async () => {
		let calls = 0;
		const client = makeClient(
			async () => {
				calls += 1;
				if (calls === 1) {
					return new Response("", { status: 503 });
				}
				return Response.json({ id: 7, title: "Tour", slug: "tour" });
			},
			{ maxReadRetries: 1 },
		);

		const activity = await client.v1.activity.get(7);
		expect(activity.id).toBe(7);
		expect(calls).toBe(2);
	});

	it("accepts numeric strings in activity photo dimensions", async () => {
		const client = clientWith(async () =>
			Response.json({
				id: 942570,
				keyPhoto: {
					height: "1365",
					originalUrl: "https://imgcdn.bokun.tools/photo.jpg",
					width: "2048",
				},
				photos: [
					{
						height: "1365",
						originalUrl: "https://imgcdn.bokun.tools/photo.jpg",
						width: "2048",
					},
				],
				title: "Geres Private Tour",
			}),
		);

		const activity = await client.v1.activity.get(942570);

		expect(activity.keyPhoto?.height).toBe(1365);
		expect(activity.keyPhoto?.width).toBe(2048);
		expect(activity.photos?.[0]?.height).toBe(1365);
	});

	it("does not retry mutations", async () => {
		let calls = 0;
		const client = makeClient(
			async () => {
				calls += 1;
				return new Response("", { status: 503 });
			},
			{ maxReadRetries: 1 },
		);

		await client.v1.activity
			.search({ keywords: "kayak" })
			.catch(() => undefined);

		expect(calls).toBe(1);
	});

	it("flags malformed responses as validation errors", async () => {
		const client = clientWith(async () =>
			Response.json({ items: "not-an-array" }),
		);

		const error = await client.v2.pricing
			.getPromoCodes({ pageNo: 1, pageSize: 10 })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(BokunResponseValidationError);
	});

	it("raises an abort error when the context signal is already aborted", async () => {
		const client = clientWith(async () => Response.json({ id: 1 }));
		const controller = new AbortController();
		controller.abort();

		const error = await client.v1.accommodation
			.get(1, {}, { signal: controller.signal })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(BokunRequestAbortedError);
	});
});
