import type { z } from "zod";
import {
	HostkitApiError,
	HostkitConfigurationError,
	HostkitNetworkError,
	HostkitRequestAbortedError,
	HostkitResponseValidationError,
	HostkitTimeoutError,
} from "./errors";
import { redactHostkitText } from "./redaction";
import {
	hostkitAddCreditNoteResultSchema,
	hostkitAddInvoiceLineResultSchema,
	hostkitAddInvoiceResultSchema,
	hostkitCloseInvoiceResultSchema,
	hostkitCreditNoteListSchema,
	hostkitInvoiceListSchema,
	hostkitLastSibaDateSchema,
	hostkitOnlineCheckinSchema,
	hostkitPropertySchema,
	hostkitStatusSchema,
} from "./schemas";
import type * as T from "./types";

const DEFAULT_BASE_URL = "https://app.hostkit.pt/api/";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_READ_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

type Query = Record<string, number | string | undefined>;

interface RequestOptions<TSchema extends z.ZodType> {
	context?: T.HostkitRequestContext;
	endpoint: string;
	/**
	 * Every Hostkit call is an HTTP GET, but most endpoints mutate state.
	 * Only calls marked `read` are safe to retry automatically.
	 */
	kind: "mutation" | "read";
	query?: Query;
	schema: TSchema;
}

/**
 * Minimal typed client for the Hostkit REST API (https://hostkit.pt/api/).
 *
 * Hostkit API keys are property-scoped, so one client instance serves exactly
 * one property. Authentication travels as an `APIKEY` query parameter; every
 * error path is scrubbed with {@link redactHostkitText} so the key never
 * reaches logs.
 */
export class HostkitClient {
	readonly guests = {
		add: (input: T.HostkitAddGuestInput, context?: T.HostkitRequestContext) =>
			this.mutation(
				"addGuest",
				{
					arrival: input.arrival,
					birthday: input.birthday,
					city_residence: input.cityResidence ?? "-",
					country_residence: input.countryResidence,
					departure: input.departure,
					doc_country: input.documentCountry,
					doc_id: input.documentId,
					doc_type: input.documentType,
					first_name: input.firstName,
					last_name: input.lastName,
					nationality: input.nationality,
					rcode: input.rcode,
				},
				hostkitStatusSchema,
				context,
			),
		onlineCheckin: (
			input: T.HostkitReservationCodeInput,
			context?: T.HostkitRequestContext,
		) =>
			this.read(
				"getOnlineCheckin",
				{ rcode: input.rcode },
				hostkitOnlineCheckinSchema,
				context,
			),
		remove: (
			input: T.HostkitRemoveGuestInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"removeGuest",
				{ name: input.name, rcode: input.rcode },
				hostkitStatusSchema,
				context,
			),
		removeAll: (
			input: T.HostkitReservationCodeInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"removeAllGuests",
				{ rcode: input.rcode },
				hostkitStatusSchema,
				context,
			),
	};

	readonly invoicing = {
		addCreditNote: (
			input: T.HostkitAddCreditNoteInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"addCreditNote",
				{
					invoice_type: input.invoiceType,
					invoicing_nif: input.invoicingNif,
					refid: input.refId,
					refseries: input.refSeries,
				},
				hostkitAddCreditNoteResultSchema,
				context,
			),
		addLine: (
			input: T.HostkitAddInvoiceLineInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"addInvoiceLine",
				{
					custom_descr: input.customDescription,
					discount: input.discount,
					id: input.id,
					invoicing_nif: input.invoicingNif,
					price: input.price,
					product_id: input.productId,
					qty: input.quantity,
					reason_code: input.reasonCode,
					region: input.region,
					series: input.series,
					type: input.type,
					vat: input.vat,
				},
				hostkitAddInvoiceLineResultSchema,
				context,
			),
		close: (
			input: T.HostkitInvoiceIdInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"closeInvoice",
				{
					id: input.id,
					invoice_type: input.invoiceType,
					invoicing_nif: input.invoicingNif,
					series: input.series,
				},
				hostkitCloseInvoiceResultSchema,
				context,
			),
		createDraft: (
			input: T.HostkitAddInvoiceInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"addInvoice",
				{
					address: input.address,
					city: input.city,
					comment: input.comment,
					country: input.country,
					cp: input.cp,
					customer_id: input.customerId,
					invoice_type: input.invoiceType,
					invoicing_nif: input.invoicingNif,
					name: input.name,
					payment_method: input.paymentMethod,
					rcode: input.rcode,
					series: input.series,
				},
				hostkitAddInvoiceResultSchema,
				context,
			),
		deleteDraft: (
			input: T.HostkitInvoiceIdInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"deleteInvoice",
				{
					id: input.id,
					invoice_type: input.invoiceType,
					invoicing_nif: input.invoicingNif,
					series: input.series,
				},
				hostkitStatusSchema,
				context,
			),
		listCreditNotes: (
			query: T.HostkitCreditNotesQuery,
			context?: T.HostkitRequestContext,
		) =>
			this.read(
				"getCreditNotes",
				{ invoicing_nif: query.invoicingNif, series: query.series },
				hostkitCreditNoteListSchema,
				context,
			),
		listReservationInvoices: (
			query: T.HostkitReservationInvoicesQuery,
			context?: T.HostkitRequestContext,
		) =>
			this.read(
				"getReservationInvoices",
				{ invoicing_nif: query.invoicingNif, rcode: query.rcode },
				hostkitInvoiceListSchema,
				context,
			),
	};

	readonly property = {
		get: (context?: T.HostkitRequestContext) =>
			this.read("getProperty", {}, hostkitPropertySchema, context),
	};

	readonly siba = {
		lastSubmissionDate: (context?: T.HostkitRequestContext) =>
			this.read("getLastSIBADate", {}, hostkitLastSibaDateSchema, context),
		send: (
			input: T.HostkitReservationCodeInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"sendSIBA",
				{ rcode: input.rcode },
				hostkitStatusSchema,
				context,
			),
		validate: (
			input: T.HostkitReservationCodeInput,
			context?: T.HostkitRequestContext,
		) =>
			this.mutation(
				"validateSIBA",
				{ rcode: input.rcode },
				hostkitStatusSchema,
				context,
			),
	};

	readonly #apiKey: string;
	readonly #baseUrl: URL;
	readonly #fetch: T.HostkitFetch;
	readonly #maxReadRetries: number;
	readonly #retryDelayMs: number;
	readonly #timeoutMs: number;
	readonly #uid?: string;

	constructor(options: T.HostkitClientOptions) {
		const apiKey = options.apiKey.trim();
		if (!apiKey) {
			throw new HostkitConfigurationError("Hostkit API key is required");
		}

		this.#apiKey = apiKey;
		this.#baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
		if (this.#baseUrl.protocol !== "https:") {
			throw new HostkitConfigurationError("Hostkit base URL must use HTTPS");
		}
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#maxReadRetries = options.maxReadRetries ?? DEFAULT_MAX_READ_RETRIES;
		this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.#uid = options.uid;

		if (
			!Number.isInteger(this.#maxReadRetries) ||
			this.#maxReadRetries < 0 ||
			this.#maxReadRetries > 5 ||
			!Number.isFinite(this.#retryDelayMs) ||
			this.#retryDelayMs < 0 ||
			this.#retryDelayMs > 30_000 ||
			!Number.isFinite(this.#timeoutMs) ||
			this.#timeoutMs <= 0 ||
			this.#timeoutMs > 120_000
		) {
			throw new HostkitConfigurationError(
				"Hostkit retry and timeout options must be valid positive values",
			);
		}
	}

	private read<TSchema extends z.ZodType>(
		endpoint: string,
		query: Query,
		schema: TSchema,
		context?: T.HostkitRequestContext,
	): Promise<z.output<TSchema>> {
		return this.request({ context, endpoint, kind: "read", query, schema });
	}

	private mutation<TSchema extends z.ZodType>(
		endpoint: string,
		query: Query,
		schema: TSchema,
		context?: T.HostkitRequestContext,
	): Promise<z.output<TSchema>> {
		return this.request({
			context,
			endpoint,
			kind: "mutation",
			query,
			schema,
		});
	}

	private async request<TSchema extends z.ZodType>({
		context,
		endpoint,
		kind,
		query,
		schema,
	}: RequestOptions<TSchema>): Promise<z.output<TSchema>> {
		const requestId = crypto.randomUUID();
		const maxAttempts = kind === "read" ? this.#maxReadRetries + 1 : 1;
		let attempt = 0;

		while (attempt < maxAttempts) {
			attempt += 1;

			try {
				return await this.performRequest({
					context,
					endpoint,
					kind,
					query,
					requestId,
					schema,
				});
			} catch (error) {
				if (context?.signal?.aborted) {
					throw new HostkitRequestAbortedError("Hostkit request was aborted", {
						cause: error,
						requestId,
					});
				}

				if (!shouldRetry(error, kind, attempt, maxAttempts)) {
					throw error;
				}

				await sleep(this.#retryDelayMs * 2 ** (attempt - 1));
			}
		}

		throw new HostkitNetworkError("Hostkit request exhausted retries", {
			requestId,
		});
	}

	private async performRequest<TSchema extends z.ZodType>({
		context,
		endpoint,
		kind,
		query,
		requestId,
		schema,
	}: RequestOptions<TSchema> & { requestId: string }): Promise<
		z.output<TSchema>
	> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
		const abort = () => controller.abort(context?.signal?.reason);
		context?.signal?.addEventListener("abort", abort, { once: true });
		if (context?.signal?.aborted) {
			abort();
		}

		try {
			const url = new URL(endpoint, this.#baseUrl);
			url.searchParams.set("APIKEY", this.#apiKey);
			if (this.#uid !== undefined) {
				url.searchParams.set("uid", this.#uid);
			}
			for (const [key, value] of Object.entries(query ?? {})) {
				if (value === undefined) {
					continue;
				}
				url.searchParams.set(key, String(value));
			}

			const response = await this.#fetch(url, {
				headers: { Accept: "application/json" },
				method: "GET",
				signal: controller.signal,
			});
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new HostkitApiError(
					`Hostkit ${endpoint} failed with status ${response.status}`,
					response.status,
					{
						providerMessage: providerError(payload, this.#apiKey),
						requestId,
					},
				);
			}

			const providerMessage = providerError(payload, this.#apiKey);
			if (providerMessage !== undefined) {
				throw new HostkitApiError(
					`Hostkit rejected ${endpoint}`,
					response.status,
					{ providerMessage, requestId },
				);
			}

			const result = schema.safeParse(payload);
			if (!result.success) {
				throw new HostkitResponseValidationError(
					`Hostkit ${endpoint} returned an unexpected response shape`,
					{
						cause: result.error,
						issues: result.error.issues.map((issue) => ({
							code: issue.code,
							message: issue.message,
							path: issue.path.map(String).join(".") || "(root)",
						})),
						requestId,
						responseShape: describeShape(payload),
					},
				);
			}

			const parsed = result.data;
			if (kind === "mutation" && isNonSuccessStatus(parsed)) {
				throw new HostkitApiError(
					`Hostkit ${endpoint} did not succeed`,
					response.status,
					{
						providerMessage: redactHostkitText(String(parsed.status), [
							this.#apiKey,
						]),
						requestId,
					},
				);
			}

			return parsed;
		} catch (error) {
			if (
				error instanceof HostkitApiError ||
				error instanceof HostkitResponseValidationError
			) {
				throw error;
			}

			if (controller.signal.aborted) {
				throw new HostkitTimeoutError(
					"Hostkit request timed out or was aborted",
					{ cause: error, requestId },
				);
			}

			throw new HostkitNetworkError(
				"Hostkit request failed before a response",
				{ cause: error, requestId },
			);
		} finally {
			clearTimeout(timeout);
			context?.signal?.removeEventListener("abort", abort);
		}
	}
}

/**
 * Every mutation endpoint answers `{ "status": "success", ... }` on success.
 * Reads are exempt: they either have no `status` field or use it for domain
 * state (online check-in reports "done").
 */
function isNonSuccessStatus(value: unknown): value is { status: unknown } {
	return (
		isRecord(value) &&
		typeof value.status === "string" &&
		value.status !== "success"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function providerError(value: unknown, apiKey: string): string | undefined {
	return isRecord(value) && typeof value.error === "string"
		? redactHostkitText(value.error, [apiKey])
		: undefined;
}

async function readPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Renders a PII-safe skeleton of a value: object keys mapped to their value
 * types, recursively, with all leaf values replaced by their type name, so a
 * response holding guest identity or invoice data never enters logs verbatim.
 */
function describeShape(value: unknown, depth = 2): string {
	return JSON.stringify(shapeOf(value, depth));
}

function shapeOf(value: unknown, depth: number): unknown {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return value.length === 0 || depth <= 0
			? "array"
			: [shapeOf(value[0], depth - 1)];
	}
	if (typeof value === "object") {
		if (depth <= 0) {
			return "object";
		}
		const shape: Record<string, unknown> = {};
		const keys = Object.keys(value as Record<string, unknown>).slice(0, 50);
		for (const key of keys) {
			shape[key] = shapeOf((value as Record<string, unknown>)[key], depth - 1);
		}
		return shape;
	}
	return typeof value;
}

function shouldRetry(
	error: unknown,
	kind: "mutation" | "read",
	attempt: number,
	maxAttempts: number,
): boolean {
	if (kind !== "read" || attempt >= maxAttempts) {
		return false;
	}

	return (
		(error instanceof HostkitApiError ||
			error instanceof HostkitNetworkError ||
			error instanceof HostkitTimeoutError) &&
		error.retryable
	);
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
