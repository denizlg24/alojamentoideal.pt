import {
	accommodationItemDetail as accommodationItemDetailTable,
	type Database,
	type OrderInvoice,
	orderContact as orderContactTable,
	orderInvoice as orderInvoiceTable,
	orderItemCharge as orderItemChargeTable,
	orderItem as orderItemTable,
	order as orderTable,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { HostkitClient } from "../integrations/hostkit";
import { redactHostkitText } from "../integrations/hostkit";
import { InvoicingError } from "./errors";
import {
	buildInvoiceCustomerDraft,
	buildInvoiceLine,
	type EditableInvoiceLine,
	editableInvoiceLinesTotalMinor,
	editableInvoiceLineToDraft,
	type InvoiceChargeRow,
	type InvoiceCustomerDraft,
	type InvoiceLineDraft,
	invoiceableCharges,
	type ResolvedInvoiceCustomer,
	resolveDraftInvoiceCustomer,
	resolveInvoiceCustomer,
	toEditableInvoiceLine,
} from "./invoices";

/**
 * Stripe card payments map to Hostkit's CC (credit card) payment method; the
 * legacy app's TB (bank transfer) predates card checkout.
 */
const DEFAULT_PAYMENT_METHOD = "CC";

/** Fiscal documents are Portuguese; only euro orders can be issued. */
const SUPPORTED_CURRENCY = "EUR";

export interface InvoicingServiceOptions {
	db: Database;
	now?: () => Date;
	/** Hostkit payment method code stamped on issued invoices. */
	paymentMethod?: string;
	/** Returns the property-scoped Hostkit client, or null when not set up. */
	resolveHostkitClient: (
		listingId: string,
	) => HostkitClient | null | Promise<HostkitClient | null>;
}

export interface CreateOrderItemInvoiceInput {
	/** FR (invoice-receipt, default: payment already settled) or FT. */
	invoiceType?: "FR" | "FT";
	orderItemId: string;
	orderReference: string;
}

export interface CreateCreditNoteInput {
	invoiceId: string;
	orderReference: string;
}

export interface BuildInvoiceDraftInput {
	orderItemId: string;
	orderReference: string;
}

/**
 * Prefilled, fully editable invoice the operator reviews before issuing. Built
 * from our own order state with no provider call, so opening the form is cheap
 * and side-effect free.
 */
export interface OrderItemInvoiceDraft {
	currency: string;
	customer: InvoiceCustomerDraft;
	/** Whether the item's listing has a Hostkit API key (issuance is possible). */
	hostkitConfigured: boolean;
	invoiceType: "FR" | "FT";
	itemTitle: string;
	lines: EditableInvoiceLine[];
	orderItemId: string;
	reservationCode: string | null;
}

export interface CreateOrderItemInvoiceFromLinesInput {
	customer: InvoiceCustomerDraft;
	invoiceType?: "FR" | "FT";
	lines: EditableInvoiceLine[];
	orderItemId: string;
	orderReference: string;
}

/**
 * Issues fiscal documents through Hostkit from our own durable order state
 * (order item charge rows — what the customer actually paid), never from
 * provider fee feeds. Every document is recorded in `order_invoices` before
 * and after the provider calls so money paperwork is reconstructable.
 *
 * Deliberately admin-only and unwired from the customer flow: nothing calls
 * this on payment; an operator (or a future M7 dashboard action) does.
 */
export class InvoicingService {
	readonly #db: Database;
	readonly #now: () => Date;
	readonly #paymentMethod: string;
	readonly #resolveHostkitClient: InvoicingServiceOptions["resolveHostkitClient"];

	constructor(options: InvoicingServiceOptions) {
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
		this.#paymentMethod = options.paymentMethod ?? DEFAULT_PAYMENT_METHOD;
		this.#resolveHostkitClient = options.resolveHostkitClient;
	}

	async listOrderInvoices(orderReference: string): Promise<OrderInvoice[]> {
		const order = await this.#loadOrder(orderReference);
		return this.#db
			.select()
			.from(orderInvoiceTable)
			.where(eq(orderInvoiceTable.orderId, order.id))
			.orderBy(asc(orderInvoiceTable.createdAt));
	}

	/**
	 * Creates, fills and closes a Hostkit invoice for one order item from the
	 * order's own charge rows (the automatic mapping). The local row is inserted
	 * as `draft` first — the partial unique index makes a concurrent or repeated
	 * issuance fail fast instead of double-billing.
	 */
	async createInvoiceForOrderItem(
		input: CreateOrderItemInvoiceInput,
	): Promise<OrderInvoice> {
		const order = await this.#loadOrder(input.orderReference);
		this.#assertInvoiceable(order, input.orderReference);
		const item = await this.#loadOrderItem(order.id, input.orderItemId);

		const contact = await this.#loadContact(order.id);
		const customerResult = resolveInvoiceCustomer(contact);
		if (customerResult.kind === "unresolved_country") {
			throw new InvoicingError(
				"customer_country_unresolved",
				"billing country is missing or not a recognized ISO code; fix the order contact before invoicing",
			);
		}

		const charges = await this.#loadInvoiceableCharges(item.id);
		if (charges.length === 0) {
			throw new InvoicingError(
				"order_item_not_found",
				"order item has no charge rows to invoice",
			);
		}
		const reservationCode = await this.#loadReservationCode(item.id);

		return this.#issueInvoiceForItem({
			customer: customerResult.customer,
			hostifyListingId: item.hostifyListingId,
			invoiceType: input.invoiceType ?? "FR",
			lines: charges.map(buildInvoiceLine),
			order,
			orderItemId: item.id,
			reservationCode,
			totalMinor: item.totalMinor,
		});
	}

	/**
	 * Builds a prefilled, fully editable invoice for one order item without any
	 * provider call. Feeds the semi-manual invoicing form; the operator edits
	 * lines and the recipient before calling
	 * {@link createOrderItemInvoiceFromLines}.
	 */
	async buildOrderItemInvoiceDraft(
		input: BuildInvoiceDraftInput,
	): Promise<OrderItemInvoiceDraft> {
		const order = await this.#loadOrder(input.orderReference);
		this.#assertInvoiceable(order, input.orderReference);
		const item = await this.#loadOrderItem(order.id, input.orderItemId);
		const contact = await this.#loadContact(order.id);
		const charges = await this.#loadInvoiceableCharges(item.id);
		const reservationCode = await this.#loadReservationCode(item.id);

		return {
			currency: order.currency,
			customer: buildInvoiceCustomerDraft(contact),
			hostkitConfigured:
				(await this.#resolveHostkitClient(item.hostifyListingId)) !== null,
			invoiceType: "FR",
			itemTitle: item.title,
			lines: charges.map(buildInvoiceLine).map(toEditableInvoiceLine),
			orderItemId: item.id,
			reservationCode,
		};
	}

	/**
	 * Issues a Hostkit invoice for one order item from operator-edited lines and
	 * recipient. Same draft-first, close-then-persist flow as the automatic
	 * path, but the document may legitimately diverge from the charged total —
	 * the operator is trusted.
	 */
	async createOrderItemInvoiceFromLines(
		input: CreateOrderItemInvoiceFromLinesInput,
	): Promise<OrderInvoice> {
		const order = await this.#loadOrder(input.orderReference);
		this.#assertInvoiceable(order, input.orderReference);
		const item = await this.#loadOrderItem(order.id, input.orderItemId);

		if (!input.customer.name.trim()) {
			throw new InvoicingError(
				"billing_contact_missing",
				"invoice recipient name is required",
			);
		}
		const customerResult = resolveDraftInvoiceCustomer(input.customer);
		if (customerResult.kind === "unresolved_country") {
			throw new InvoicingError(
				"customer_country_unresolved",
				"recipient country is missing or not a recognized ISO code",
			);
		}

		const lines = input.lines
			.filter(isFilledInvoiceLine)
			.map(editableInvoiceLineToDraft);
		if (lines.length === 0) {
			throw new InvoicingError(
				"order_item_not_found",
				"the invoice needs at least one line with a product, quantity and price",
			);
		}
		const reservationCode = await this.#loadReservationCode(item.id);

		return this.#issueInvoiceForItem({
			customer: customerResult.customer,
			hostifyListingId: item.hostifyListingId,
			invoiceType: input.invoiceType ?? "FR",
			lines,
			order,
			orderItemId: item.id,
			reservationCode,
			totalMinor: editableInvoiceLinesTotalMinor(input.lines),
		});
	}

	/** Order must be a confirmed euro order to carry a fiscal document. */
	#assertInvoiceable(
		order: { currency: string; status: string },
		reference: string,
	): void {
		if (order.status !== "confirmed") {
			throw new InvoicingError(
				"order_not_paid",
				`order ${reference} is ${order.status}; only confirmed orders can be invoiced`,
			);
		}
		if (order.currency.toUpperCase() !== SUPPORTED_CURRENCY) {
			throw new InvoicingError(
				"currency_unsupported",
				`order currency ${order.currency} is not supported for fiscal documents`,
			);
		}
	}

	async #loadInvoiceableCharges(
		orderItemId: string,
	): Promise<InvoiceChargeRow[]> {
		const rows = await this.#db
			.select({
				grossMinor: orderItemChargeTable.grossMinor,
				kind: orderItemChargeTable.kind,
				name: orderItemChargeTable.name,
				netMinor: orderItemChargeTable.netMinor,
				rawPayload: orderItemChargeTable.rawPayload,
				taxMinor: orderItemChargeTable.taxMinor,
				taxRateBasisPoints: orderItemChargeTable.taxRateBasisPoints,
			})
			.from(orderItemChargeTable)
			.where(eq(orderItemChargeTable.orderItemId, orderItemId))
			.orderBy(asc(orderItemChargeTable.position));
		return invoiceableCharges(
			rows.map((charge) => ({
				feeSubtype: feeSubtypeFromRawPayload(charge.rawPayload),
				grossMinor: charge.grossMinor,
				kind: charge.kind,
				name: charge.name,
				netMinor: charge.netMinor,
				taxMinor: charge.taxMinor,
				taxRateBasisPoints: charge.taxRateBasisPoints,
			})),
		);
	}

	/**
	 * Shared Hostkit issuance: insert the local draft guard, create the provider
	 * draft, add every line, close, then persist the issued state. Cleans up a
	 * half-filled provider draft on failure and records a redacted error.
	 */
	async #issueInvoiceForItem(params: {
		customer: ResolvedInvoiceCustomer;
		hostifyListingId: string;
		invoiceType: "FR" | "FT";
		lines: InvoiceLineDraft[];
		order: { currency: string; id: string };
		orderItemId: string;
		reservationCode: string | null;
		totalMinor: number;
	}): Promise<OrderInvoice> {
		const client = await this.#resolveHostkitClient(params.hostifyListingId);
		if (!client) {
			throw new InvoicingError(
				"hostkit_not_configured",
				`no Hostkit API key configured for listing ${params.hostifyListingId}`,
			);
		}

		const record = await this.#insertDraftRecord({
			currency: params.order.currency,
			orderId: params.order.id,
			orderItemId: params.orderItemId,
			reservationCode: params.reservationCode,
			totalMinor: params.totalMinor,
		});

		let hostkitInvoiceId: string | null = null;
		let providerDraftClosed = false;
		try {
			const property = await client.property.get();
			const invoicingNif = property.invoicing_nif ?? null;
			const series = property.default_series ?? null;
			if (!invoicingNif || !series) {
				throw new InvoicingError(
					"property_unconfigured",
					"Hostkit property has no invoicing NIF or default series configured",
				);
			}

			const customer = params.customer;
			const draft = await client.invoicing.createDraft({
				address: customer.address,
				city: customer.city,
				country: customer.country,
				cp: customer.cp,
				customerId: customer.customerId,
				invoiceType: params.invoiceType,
				invoicingNif,
				name: customer.name,
				paymentMethod: this.#paymentMethod,
				rcode: params.reservationCode ?? undefined,
				series,
			});
			if (draft.id === null || draft.id === undefined) {
				throw new InvoicingError(
					"provider_error",
					"Hostkit created an invoice draft without an id",
				);
			}
			hostkitInvoiceId = String(draft.id);
			await this.#updateRecord(record.id, {
				hostkitInvoiceId,
				hostkitSeries: series,
				invoicingNif,
			});

			for (const line of params.lines) {
				await client.invoicing.addLine({
					...line,
					id: hostkitInvoiceId,
					invoicingNif,
					series,
				});
			}

			const closed = await client.invoicing.close({
				id: hostkitInvoiceId,
				invoicingNif,
				series,
			});
			providerDraftClosed = true;

			// Provider draft is now closed; persist the issued state as a separate
			// step so DB failures are handled distinctly from API failures.
			try {
				const now = this.#now();
				await this.#updateRecord(record.id, {
					documentUrl: closed.invoice_url ?? null,
					issuedAt: now,
					status: "issued",
				});
				return await this.#loadRecord(record.id);
			} catch (persistError) {
				// The Hostkit invoice was successfully closed, but we failed to
				// persist the issued state. Wrap the error to surface this state
				// so operators know the provider has the closed invoice even if
				// our DB record is stuck as draft. A reconciliation job or manual
				// fix-up (SELECT invoices WHERE status='draft' AND
				// hostkitInvoiceId IS NOT NULL) can recover these orphans.
				const message = describeError(persistError);
				throw new InvoicingError(
					"provider_closed_but_persistence_failed",
					`Hostkit invoice ${hostkitInvoiceId} was successfully closed, but recording the issued state failed: ${message}. The invoice exists on the provider; the local draft record needs manual reconciliation.`,
				);
			}
		} catch (error) {
			if (providerDraftClosed) {
				// Re-throw persistence errors wrapped above; they already have context.
				throw error;
			}

			// Leave no half-filled provider draft behind; best-effort only, the
			// failed local row keeps the trail either way.
			if (hostkitInvoiceId) {
				try {
					await client.invoicing.deleteDraft({ id: hostkitInvoiceId });
				} catch {
					// The failed row already records the primary error.
				}
			}
			const message = describeError(error);
			await this.#updateRecord(record.id, {
				lastErrorMessage: message,
				status: "failed",
			});
			if (error instanceof InvoicingError) {
				throw error;
			}
			throw new InvoicingError(
				"provider_error",
				`Hostkit invoice issuance failed: ${message}`,
			);
		}
	}

	/**
	 * Issues a credit note against a previously issued invoice. Hostkit builds
	 * the note from the closed invoice, so no line mapping happens here.
	 */
	async createCreditNote(input: CreateCreditNoteInput): Promise<OrderInvoice> {
		const order = await this.#loadOrder(input.orderReference);
		const rows = await this.#db
			.select()
			.from(orderInvoiceTable)
			.where(
				and(
					eq(orderInvoiceTable.id, input.invoiceId),
					eq(orderInvoiceTable.orderId, order.id),
				),
			)
			.limit(1);
		const invoice = rows[0];
		if (!invoice) {
			throw new InvoicingError("invoice_not_found", "invoice not found");
		}
		if (
			invoice.kind !== "invoice" ||
			invoice.status !== "issued" ||
			!invoice.hostkitInvoiceId ||
			!invoice.hostkitSeries
		) {
			throw new InvoicingError(
				"credit_note_target_invalid",
				"credit notes can only be issued against a successfully issued invoice",
			);
		}

		const item = await this.#loadOrderItem(order.id, invoice.orderItemId);
		const client = await this.#resolveHostkitClient(item.hostifyListingId);
		if (!client) {
			throw new InvoicingError(
				"hostkit_not_configured",
				`no Hostkit API key configured for listing ${item.hostifyListingId}`,
			);
		}

		const record = await this.#insertCreditNoteDraftRecord({
			currency: invoice.currency,
			invoicingNif: invoice.invoicingNif,
			orderId: order.id,
			orderItemId: invoice.orderItemId,
			refInvoiceId: invoice.id,
			reservationCode: invoice.reservationCode,
			series: invoice.hostkitSeries,
			totalMinor: -invoice.totalMinor,
		});

		let providerCreditNoteCreated = false;
		try {
			const created = await client.invoicing.addCreditNote({
				invoicingNif: invoice.invoicingNif ?? undefined,
				refId: invoice.hostkitInvoiceId,
				refSeries: invoice.hostkitSeries,
			});
			if (created.id === null || created.id === undefined) {
				throw new InvoicingError(
					"provider_error",
					"Hostkit created a credit note without an id",
				);
			}
			const creditNoteId = String(created.id);
			providerCreditNoteCreated = true;

			// Provider credit note is now created; persist the issued state as a
			// separate step so DB failures are handled distinctly from API failures.
			try {
				const documentUrl = await this.#findCreditNoteUrl(
					client,
					invoice.hostkitSeries,
					invoice.hostkitInvoiceId,
					invoice.invoicingNif,
				);

				const now = this.#now();
				await this.#updateRecord(record.id, {
					documentUrl,
					hostkitInvoiceId: creditNoteId,
					issuedAt: now,
					lastErrorMessage: null,
					status: "issued",
				});
				return await this.#loadRecord(record.id);
			} catch (persistError) {
				// The Hostkit credit note was successfully created, but we failed
				// to persist the issued state. Wrap the error to surface this state
				// so operators know the provider has the credit note even if our DB
				// record is stuck as draft. A reconciliation job or manual fix-up
				// (SELECT invoices WHERE status='draft' AND hostkitInvoiceId IS NOT
				// NULL AND kind='credit_note') can recover these orphans.
				const message = describeError(persistError);
				throw new InvoicingError(
					"provider_closed_but_persistence_failed",
					`Hostkit credit note ${creditNoteId} was successfully created, but recording the issued state failed: ${message}. The credit note exists on the provider; the local draft record needs manual reconciliation.`,
				);
			}
		} catch (error) {
			if (providerCreditNoteCreated) {
				// Re-throw persistence errors wrapped above; they already have context.
				throw error;
			}

			const message = describeError(error);
			await this.#updateRecord(record.id, {
				lastErrorMessage: message,
				status: "failed",
			});
			if (error instanceof InvoicingError) {
				throw error;
			}
			throw new InvoicingError(
				"provider_error",
				`Hostkit credit note issuance failed: ${message}`,
			);
		}
	}

	/** The note URL is only exposed on the series listing, keyed by refid. */
	async #findCreditNoteUrl(
		client: HostkitClient,
		series: string,
		refId: string,
		invoicingNif: string | null,
	): Promise<string | null> {
		try {
			const notes = await client.invoicing.listCreditNotes({
				invoicingNif: invoicingNif ?? undefined,
				series,
			});
			const match = notes.find(
				(note) =>
					note.refid !== null &&
					note.refid !== undefined &&
					String(note.refid) === refId,
			);
			return match?.credit_note_url ?? null;
		} catch {
			return null;
		}
	}

	async #insertDraftRecord(values: {
		currency: string;
		orderId: string;
		orderItemId: string;
		reservationCode: string | null;
		totalMinor: number;
	}) {
		const id = crypto.randomUUID();
		try {
			await this.#db.insert(orderInvoiceTable).values({
				currency: values.currency,
				id,
				kind: "invoice",
				orderId: values.orderId,
				orderItemId: values.orderItemId,
				reservationCode: values.reservationCode,
				status: "draft",
				totalMinor: values.totalMinor,
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new InvoicingError(
					"already_invoiced",
					"an invoice for this order item already exists (draft or issued)",
				);
			}
			throw error;
		}
		return { id };
	}

	async #insertCreditNoteDraftRecord(values: {
		currency: string;
		invoicingNif: string | null;
		orderId: string;
		orderItemId: string;
		refInvoiceId: string;
		reservationCode: string | null;
		series: string | null;
		totalMinor: number;
	}) {
		const id = crypto.randomUUID();
		await this.#db.insert(orderInvoiceTable).values({
			currency: values.currency,
			hostkitSeries: values.series,
			id,
			invoicingNif: values.invoicingNif,
			kind: "credit_note",
			orderId: values.orderId,
			orderItemId: values.orderItemId,
			refInvoiceId: values.refInvoiceId,
			reservationCode: values.reservationCode,
			status: "draft",
			totalMinor: values.totalMinor,
		});
		return { id };
	}

	async #updateRecord(
		id: string,
		values: Partial<typeof orderInvoiceTable.$inferInsert>,
	): Promise<void> {
		await this.#db
			.update(orderInvoiceTable)
			.set({ ...values, updatedAt: this.#now() })
			.where(eq(orderInvoiceTable.id, id));
	}

	async #loadRecord(id: string): Promise<OrderInvoice> {
		const rows = await this.#db
			.select()
			.from(orderInvoiceTable)
			.where(eq(orderInvoiceTable.id, id))
			.limit(1);
		const record = rows[0];
		if (!record) {
			throw new InvoicingError("invoice_not_found", "invoice record vanished");
		}
		return record;
	}

	async #loadOrder(orderReference: string) {
		const rows = await this.#db
			.select({
				currency: orderTable.currency,
				id: orderTable.id,
				status: orderTable.status,
			})
			.from(orderTable)
			.where(
				eq(orderTable.publicReference, orderReference.trim().toUpperCase()),
			)
			.limit(1);
		const order = rows[0];
		if (!order) {
			throw new InvoicingError("order_not_found", "order not found");
		}
		return order;
	}

	async #loadOrderItem(orderId: string, orderItemId: string) {
		const rows = await this.#db
			.select({
				hostifyListingId: accommodationItemDetailTable.hostifyListingId,
				id: orderItemTable.id,
				title: orderItemTable.titleSnapshot,
				totalMinor: orderItemTable.totalMinor,
			})
			.from(orderItemTable)
			.innerJoin(
				accommodationItemDetailTable,
				eq(accommodationItemDetailTable.orderItemId, orderItemTable.id),
			)
			.where(
				and(
					eq(orderItemTable.id, orderItemId),
					eq(orderItemTable.orderId, orderId),
				),
			)
			.limit(1);
		const item = rows[0];
		if (!item) {
			throw new InvoicingError(
				"order_item_not_found",
				"order item not found on this order",
			);
		}
		return item;
	}

	async #loadContact(orderId: string) {
		const rows = await this.#db
			.select({
				billingAddress: orderContactTable.billingAddress,
				companyName: orderContactTable.companyName,
				isCompany: orderContactTable.isCompany,
				name: orderContactTable.name,
				taxNumber: orderContactTable.taxNumber,
			})
			.from(orderContactTable)
			.where(eq(orderContactTable.orderId, orderId))
			.limit(1);
		const contact = rows[0];
		if (!contact) {
			throw new InvoicingError(
				"billing_contact_missing",
				"order has no billing contact",
			);
		}
		const address = contact.billingAddress;
		return {
			billingCity: stringOrNull(address.city),
			billingCountry: stringOrNull(address.country),
			billingLine1: stringOrNull(address.line1),
			billingLine2: stringOrNull(address.line2),
			billingPostalCode: stringOrNull(address.postalCode),
			companyName: contact.companyName,
			isCompany: contact.isCompany,
			name: contact.name,
			taxNumber: contact.taxNumber,
		};
	}

	async #loadReservationCode(orderItemId: string): Promise<string | null> {
		const rows = await this.#db
			.select({
				rawOperationalPayload: providerBookingTable.rawOperationalPayload,
			})
			.from(providerBookingTable)
			.where(eq(providerBookingTable.orderItemId, orderItemId))
			.limit(1);
		const payload = rows[0]?.rawOperationalPayload;
		const code = payload?.confirmation_code;
		return typeof code === "string" && code.trim() ? code.trim() : null;
	}
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function feeSubtypeFromRawPayload(
	payload: Record<string, unknown> | null,
): string | null {
	const value = payload?.feeSubtype ?? payload?.type;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isFilledInvoiceLine(line: EditableInvoiceLine): boolean {
	const price = Number(line.price);
	return (
		line.productId.trim().length > 0 &&
		line.quantity > 0 &&
		Number.isFinite(price) &&
		price !== 0
	);
}

/** Operator-facing error text: no API keys, no guest identity values. */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		const detail =
			"providerMessage" in error &&
			typeof (error as { providerMessage?: unknown }).providerMessage ===
				"string"
				? `: ${(error as { providerMessage: string }).providerMessage}`
				: ` (${error.message})`;
		return redactHostkitText(`${error.name}${detail}`).slice(0, 500);
	}
	return "unknown error";
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}
