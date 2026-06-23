import { timingSafeEqual } from "node:crypto";
import {
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
	type AppliedDiscountSnapshot,
	accommodationItemDetail as accommodationItemDetailTable,
	accommodationListing as accommodationListingTable,
	accommodationQuoteSnapshot as accommodationQuoteSnapshotTable,
	apiIdempotencyKey as apiIdempotencyKeyTable,
	cartItem as cartItemTable,
	cart as cartTable,
	type Database,
	orderContact as orderContactTable,
	orderItemCharge as orderItemChargeTable,
	orderItem as orderItemTable,
	order as orderTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { parseQuoteBody } from "../accommodations";
import { CommerceError, invalidRequest } from "./errors";
import { hashIdempotencyRequest, idempotencyExpiresAt } from "./idempotency";
import { housingFeeMinor, normalizeAccommodationQuoteSnapshot } from "./money";
import {
	allocateDiscountByHousingBase,
	buildDiscountChargeRow,
	buildDraftOrderRows,
	generatePublicOrderReference,
} from "./orders";
import {
	type MarkOrderPaidResult,
	type MarkOrderPaymentFailedResult,
	type OrderPaymentFailureInput,
	type OrderStatusRecord,
	type PayableOrder,
	type PaymentAmount,
	toOrderBookingStatus,
} from "./payments";
import type {
	AddCartItemBody,
	ApplyDiscountBody,
	DeleteCartItemBody,
	DraftOrderBody,
	UpdateCartItemBody,
} from "./schemas";
import { assertMutableCart, toCartStatus } from "./state";
import { computeDiscountMinor, sumCartTotals } from "./totals";
import type {
	CartDto,
	CartItemDto,
	CartMutationResponse,
	CartOwner,
	CartResponse,
	CartValidationFailure,
	CartValidationResponse,
	CommerceQuoteDto,
	CommerceQuoteInput,
	DraftOrderContactInput,
	DraftOrderResponse,
	ListingDisplaySnapshot,
	NormalizedAccommodationQuoteSnapshot,
	QuoteValidationStatus,
} from "./types";

const CART_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PROPERTY_TIMEZONE = "Europe/Lisbon";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;

export interface CommerceServiceOptions {
	accountId: string;
	currency: string;
	db: Database;
	provider: string;
	quoteAccommodation: (
		input: CommerceQuoteInput,
	) => Promise<import("../accommodations").AccommodationQuoteResult>;
	quoteTtlSeconds: number;
	/**
	 * Resolves a promotion code against the discount provider (Stripe). Returns
	 * `null` for unknown/inactive/expired codes; throws for provider/transport
	 * failures so the service can distinguish "invalid" from "unavailable".
	 */
	resolveDiscount: (code: string) => Promise<AppliedDiscountSnapshot | null>;
}

interface CreateCartInput {
	cartId?: string;
	idempotencyKey?: string;
}

interface ActiveItemInput {
	itemId: string;
	quoteInput: CommerceQuoteInput;
}

interface RevalidatedSnapshot {
	itemId: string;
	snapshot: NormalizedAccommodationQuoteSnapshot;
}

interface RevalidatedCartDiscount {
	applied: AppliedDiscountSnapshot | null;
	resolved: AppliedDiscountSnapshot | null;
}

interface CartJoinedRow {
	cartItemId: string;
	checkIn: string;
	checkOut: string;
	city: string | null;
	country: string | null;
	currency: string;
	externalAccountId: string;
	feeLines: NormalizedAccommodationQuoteSnapshot["feeLines"];
	fetchedAt: Date;
	guests: number;
	housingFeeMinor: number | null;
	imageFallbackName: string | null;
	infants: number;
	itemStatus: string;
	listingExternalId: string;
	nightlyAverageMinor: number | null;
	nights: number;
	pets: number;
	position: number;
	processed: AccommodationListingProcessedContent | null;
	provider: string;
	providerPayload: Record<string, unknown> | null;
	quoteAdults: number;
	quoteChildren: number;
	quoteCleaningFeeMinor: number | null;
	quoteExpiresAt: Date;
	quoteId: string;
	quoteStatus: string;
	raw: AccommodationListingRawContent | null;
	subtotalMinor: number;
	taxMinor: number;
	timezone: string | null;
	totalMinor: number;
	updatedAt: Date;
}

export class CommerceService {
	readonly #accountId: string;
	readonly #currency: string;
	readonly #db: Database;
	readonly #provider: string;
	readonly #quoteAccommodation: CommerceServiceOptions["quoteAccommodation"];
	readonly #quoteTtlSeconds: number;
	readonly #resolveDiscount: CommerceServiceOptions["resolveDiscount"];

	constructor(options: CommerceServiceOptions) {
		this.#accountId = options.accountId;
		this.#currency = options.currency;
		this.#db = options.db;
		this.#provider = options.provider;
		this.#quoteAccommodation = options.quoteAccommodation;
		this.#quoteTtlSeconds = options.quoteTtlSeconds;
		this.#resolveDiscount = options.resolveDiscount;
	}

	async createCart(
		input: CreateCartInput,
		owner: CartOwner,
	): Promise<CartResponse> {
		const payload = {
			cartId: input.cartId ?? null,
			userId: owner.userId ?? null,
		};
		const operation = (tx: Transaction) => this.#createCart(tx, input, owner);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				"cart:create",
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async getCart(cartId: string, owner: CartOwner): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		return { cart: await this.#cartDto(this.#db, cartId, new Date()) };
	}

	/**
	 * Re-reads a draft order for payment, authorizing the caller the same way
	 * carts are (the linked user, or the anonymous cart's secret token). The
	 * persisted order is the only authoritative source of the payable amount;
	 * `DraftOrderResponse` deliberately omits it. Throws when the order is
	 * missing, not owned, no longer a draft, or its checkout window has lapsed.
	 */
	async getPayableOrder(
		orderId: string,
		owner: CartOwner,
	): Promise<PayableOrder> {
		const [row] = await this.#db
			.select({
				cartId: orderTable.cartId,
				cartToken: cartTable.cartToken,
				checkoutExpiresAt: orderTable.checkoutExpiresAt,
				currency: orderTable.currency,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.where(eq(orderTable.id, orderId))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			)
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		if (row.status !== "draft") {
			throw new CommerceError(
				"order_not_payable",
				"This order can no longer be paid.",
				409,
			);
		}

		if (
			row.checkoutExpiresAt &&
			row.checkoutExpiresAt.getTime() <= Date.now()
		) {
			throw new CommerceError(
				"order_expired",
				"This checkout session has expired.",
				410,
			);
		}

		return {
			cartId: row.cartId,
			checkoutExpiresAt: row.checkoutExpiresAt
				? row.checkoutExpiresAt.toISOString()
				: null,
			currency: row.currency,
			orderId: row.id,
			publicReference: row.publicReference,
			status: toOrderBookingStatus(row.status),
			stripePaymentIntentId: row.stripePaymentIntentId,
			totalMinor: row.totalMinor,
		};
	}

	/**
	 * Resolves the payable draft order that a cart was converted into, so a guest
	 * who only kept the cart id (e.g. after a refresh) can resume payment without
	 * the order id. Access is authorized against the cart exactly like `getCart`;
	 * the delegated `getPayableOrder` re-checks ownership and payability. A cart
	 * that has not been converted yet reports no payable order.
	 */
	async getPayableOrderForCart(
		cartId: string,
		owner: CartOwner,
	): Promise<PayableOrder> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		const [row] = await this.#db
			.select({
				convertedOrderId: cartTable.convertedOrderId,
				status: cartTable.status,
			})
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (row?.status !== "converted" || !row.convertedOrderId) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return this.getPayableOrder(row.convertedOrderId, owner);
	}

	/**
	 * Owner-scoped read of a draft order's contact snapshot, used to repaint the
	 * checkout contact form after a reload (the contact is never kept in browser
	 * storage). Authorized the same way as `readOrderStatus`.
	 */
	async getOrderContact(
		publicReference: string,
		owner: CartOwner,
	): Promise<DraftOrderContactInput> {
		const [row] = await this.#db
			.select({
				billingAddress: orderContactTable.billingAddress,
				cartToken: cartTable.cartToken,
				companyName: orderContactTable.companyName,
				email: orderContactTable.email,
				isCompany: orderContactTable.isCompany,
				name: orderContactTable.name,
				notes: orderContactTable.notes,
				phoneE164: orderContactTable.phoneE164,
				taxNumber: orderContactTable.taxNumber,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.leftJoin(orderContactTable, eq(orderContactTable.orderId, orderTable.id))
			.where(eq(orderTable.publicReference, publicReference))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			) ||
			row.email === null ||
			row.name === null ||
			row.phoneE164 === null
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return {
			billingAddress: row.billingAddress ?? {},
			companyName: row.companyName,
			email: row.email,
			isCompany: row.isCompany ?? false,
			name: row.name,
			notes: row.notes,
			phoneE164: row.phoneE164,
			taxNumber: row.taxNumber,
		};
	}

	/**
	 * Updates a draft order's contact snapshot in place. The contact does not
	 * affect the order total, so the PaymentIntent stays valid. Only a `draft`
	 * order may be edited; once paid/failed the contact is frozen.
	 */
	async updateDraftOrderContact(
		publicReference: string,
		owner: CartOwner,
		contact: DraftOrderContactInput,
	): Promise<void> {
		return this.#db.transaction(async (tx) => {
			const [row] = await tx
				.select({
					cartToken: cartTable.cartToken,
					id: orderTable.id,
					status: orderTable.status,
					userId: orderTable.userId,
				})
				.from(orderTable)
				.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
				.where(eq(orderTable.publicReference, publicReference))
				.limit(1);

			if (
				!row ||
				!isOrderAccessGranted(
					{ cartToken: row.cartToken, userId: row.userId },
					owner,
				)
			) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}

			if (row.status !== "draft") {
				throw new CommerceError(
					"order_not_payable",
					"This order can no longer be changed.",
					409,
				);
			}

			await tx
				.update(orderContactTable)
				.set({
					billingAddress: contact.billingAddress,
					companyName: contact.companyName,
					email: contact.email,
					isCompany: contact.isCompany,
					name: contact.name,
					notes: contact.notes,
					phoneE164: contact.phoneE164,
					taxNumber: contact.taxNumber,
				})
				.where(eq(orderContactTable.orderId, row.id));
		});
	}

	/**
	 * Links a Stripe PaymentIntent to its order. Guarded by `IS NULL` so an
	 * idempotent retry (which yields the same intent id) cannot clobber an
	 * existing link, and concurrent writers converge on a single row.
	 */
	async attachPaymentIntentId(
		orderId: string,
		paymentIntentId: string,
	): Promise<void> {
		await this.#db
			.update(orderTable)
			.set({ stripePaymentIntentId: paymentIntentId, updatedAt: new Date() })
			.where(
				and(
					eq(orderTable.id, orderId),
					isNull(orderTable.stripePaymentIntentId),
				),
			);
	}

	/**
	 * Marks a draft/pending order as paid in response to a signature-verified
	 * `payment_intent.succeeded` webhook. Before confirming, the captured amount
	 * and currency are asserted against the persisted order total: a mismatch
	 * (e.g. a re-quote between intent creation and capture, or tampering) returns
	 * `amount_mismatch` and leaves the order unconfirmed for manual review rather
	 * than silently confirming a wrong total. The guarded UPDATE is the
	 * idempotency authority: a re-delivered event (or a racing worker) finds the
	 * order already finalized and returns `already_finalized` without
	 * re-confirming, so the caller sends exactly one confirmation email. There is
	 * no owner check here because the trust boundary is Stripe's webhook
	 * signature, not a session.
	 */
	async markOrderPaid(
		orderId: string,
		payment: PaymentAmount,
	): Promise<MarkOrderPaidResult> {
		return this.#db.transaction(async (tx) => {
			const [order] = await tx
				.select({
					currency: orderTable.currency,
					status: orderTable.status,
					totalMinor: orderTable.totalMinor,
				})
				.from(orderTable)
				.where(eq(orderTable.id, orderId))
				.limit(1);

			if (!order) {
				return { outcome: "not_found" };
			}
			if (order.status !== "draft" && order.status !== "pending") {
				return { outcome: "already_finalized" };
			}
			if (
				payment.amountMinor !== order.totalMinor ||
				payment.currency.toUpperCase() !== order.currency.toUpperCase()
			) {
				return {
					expected: {
						amountMinor: order.totalMinor,
						currency: order.currency,
					},
					outcome: "amount_mismatch",
					received: payment,
				};
			}

			const [updated] = await tx
				.update(orderTable)
				.set({
					amountPaidMinor: payment.amountMinor,
					status: "confirmed",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(orderTable.id, orderId),
						inArray(orderTable.status, ["draft", "pending"]),
					),
				)
				.returning({
					currency: orderTable.currency,
					publicReference: orderTable.publicReference,
				});

			// Lost the race to another finalizer between the read and the guarded
			// update; the order is already settled.
			if (!updated) {
				return { outcome: "already_finalized" };
			}

			const [contact] = await tx
				.select({
					billingAddress: orderContactTable.billingAddress,
					email: orderContactTable.email,
					name: orderContactTable.name,
					phoneE164: orderContactTable.phoneE164,
				})
				.from(orderContactTable)
				.where(eq(orderContactTable.orderId, orderId))
				.limit(1);

			const [reservation] = await tx
				.select({
					checkIn: accommodationItemDetailTable.checkIn,
					checkOut: accommodationItemDetailTable.checkOut,
					guests: accommodationItemDetailTable.guests,
					imageUrl: orderItemTable.imageUrlSnapshot,
					title: orderItemTable.titleSnapshot,
				})
				.from(orderItemTable)
				.innerJoin(
					accommodationItemDetailTable,
					eq(accommodationItemDetailTable.orderItemId, orderItemTable.id),
				)
				.where(eq(orderItemTable.orderId, orderId))
				.orderBy(asc(orderItemTable.position))
				.limit(1);

			return {
				confirmation: {
					accommodationImage: reservation?.imageUrl ?? null,
					accommodationTitle:
						reservation?.title ?? "Your Alojamento Ideal stay",
					amountPaidMinor: payment.amountMinor,
					billingAddress: contact?.billingAddress ?? {},
					checkIn: reservation?.checkIn ?? "To be confirmed",
					checkOut: reservation?.checkOut ?? "To be confirmed",
					contactPhone: contact?.phoneE164 ?? "",
					currency: updated.currency,
					// The contact is captured at draft creation, so a confirmed order
					// always has one; fall back rather than risk an unhandled throw.
					email: contact?.email ?? "",
					guests: reservation?.guests ?? 0,
					name: contact?.name ?? "",
					publicReference: updated.publicReference,
				},
				outcome: "confirmed",
			};
		});
	}

	/**
	 * Marks a draft/pending order as failed from a `payment_intent.payment_failed`
	 * webhook, recording Stripe's failure code/detail. Idempotent the same way as
	 * `markOrderPaid`: a re-delivery of an already-finalized order is a no-op.
	 */
	async markOrderPaymentFailed(
		orderId: string,
		failure: OrderPaymentFailureInput,
	): Promise<MarkOrderPaymentFailedResult> {
		const [updated] = await this.#db
			.update(orderTable)
			.set({
				failureCode: failure.failureCode,
				failureDetail: failure.failureDetail,
				status: "failed",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(orderTable.id, orderId),
					inArray(orderTable.status, ["draft", "pending"]),
				),
			)
			.returning({ id: orderTable.id });

		if (updated) {
			return { outcome: "failed" };
		}

		const [existing] = await this.#db
			.select({ id: orderTable.id })
			.from(orderTable)
			.where(eq(orderTable.id, orderId))
			.limit(1);
		if (existing) {
			return { outcome: "already_finalized" };
		}
		return { outcome: "not_found" };
	}

	/**
	 * Owner-scoped read of an order's persisted payment/booking facts for the
	 * completion page. Live PaymentIntent status is resolved by the route from
	 * `stripePaymentIntentId`; this never trusts client-reported payment state.
	 */
	async readOrderStatus(
		publicReference: string,
		owner: CartOwner,
	): Promise<OrderStatusRecord> {
		const [row] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				cartToken: cartTable.cartToken,
				currency: orderTable.currency,
				id: orderTable.id,
				publicReference: orderTable.publicReference,
				status: orderTable.status,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
				userId: orderTable.userId,
			})
			.from(orderTable)
			.leftJoin(cartTable, eq(cartTable.id, orderTable.cartId))
			.where(eq(orderTable.publicReference, publicReference))
			.limit(1);

		if (
			!row ||
			!isOrderAccessGranted(
				{ cartToken: row.cartToken, userId: row.userId },
				owner,
			)
		) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}

		return {
			amountPaidMinor: row.amountPaidMinor,
			bookingStatus: toOrderBookingStatus(row.status),
			currency: row.currency,
			orderId: row.id,
			publicReference: row.publicReference,
			stripePaymentIntentId: row.stripePaymentIntentId,
			totalMinor: row.totalMinor,
		};
	}

	/**
	 * Links the anonymous cart identified by `cartToken` to the authenticated
	 * user. Idempotent: re-claiming a cart the user already owns returns it; a
	 * cart owned by someone else (or absent) reports as not found.
	 */
	async claimCart(owner: CartOwner, cartToken: string): Promise<CartResponse> {
		const userId = owner.userId;
		if (!userId) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await tx
				.update(cartTable)
				.set({ updatedAt: now, userId })
				.where(
					and(
						eq(cartTable.cartToken, cartToken),
						isNull(cartTable.userId),
						eq(cartTable.status, "draft"),
					),
				);

			const [row] = await tx
				.select({ id: cartTable.id, userId: cartTable.userId })
				.from(cartTable)
				.where(eq(cartTable.cartToken, cartToken))
				.limit(1);

			if (!row || row.userId !== userId) {
				throw new CommerceError("cart_not_found", "Cart not found.", 404);
			}

			return { cart: await this.#cartDto(tx, row.id, now) };
		});
	}

	async applyDiscount(
		cartId: string,
		input: ApplyDiscountBody,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		const payload = { cartId, code: input.code };
		const scope = `cart:${cartId}:discount:apply`;
		if (input.idempotencyKey) {
			const replay = await this.#readIdempotencyReplay<CartResponse>(
				scope,
				input.idempotencyKey,
				payload,
			);
			if (replay) {
				return replay;
			}
		}

		const discount = await this.#resolveDiscount(input.code);
		if (!discount) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code is not valid.",
				422,
			);
		}

		const operation = (tx: Transaction) =>
			this.#applyDiscount(tx, cartId, discount);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				scope,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async removeDiscount(
		cartId: string,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
			await tx
				.update(cartTable)
				.set({ appliedDiscount: null, discountMinor: 0, updatedAt: now })
				.where(eq(cartTable.id, cartId));
			await this.#recalculateCartTotals(tx, cartId, now);
			return { cart: await this.#cartDto(tx, cartId, now) };
		});
	}

	async addItem(
		cartId: string,
		input: AddCartItemBody,
		owner: CartOwner,
	): Promise<CartMutationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, input };
		const scope = `cart:${cartId}:items:create`;
		const replay = await this.#readIdempotencyReplay<CartMutationResponse>(
			scope,
			input.idempotencyKey,
			payload,
		);
		if (replay) {
			return replay;
		}

		const snapshot = await this.#fetchQuoteSnapshot(input, true);
		return this.#runIdempotent(scope, input.idempotencyKey, payload, (tx) =>
			this.#addItemWithSnapshot(tx, cartId, input, snapshot),
		);
	}

	async updateItem(
		cartId: string,
		itemId: string,
		input: UpdateCartItemBody,
		owner: CartOwner,
	): Promise<CartMutationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, input, itemId };
		const scope = `cart:${cartId}:items:${itemId}:update`;
		const replay = await this.#readIdempotencyReplay<CartMutationResponse>(
			scope,
			input.idempotencyKey,
			payload,
		);
		if (replay) {
			return replay;
		}

		const current = await this.#readActiveItemInput(cartId, itemId);
		const quoteInput = mergeQuoteInput(current.quoteInput, input);
		const snapshot = await this.#fetchQuoteSnapshot(quoteInput, true);

		return this.#runIdempotent(scope, input.idempotencyKey, payload, (tx) =>
			this.#updateItemWithSnapshot(tx, cartId, itemId, snapshot),
		);
	}

	async removeItem(
		cartId: string,
		itemId: string,
		input: DeleteCartItemBody,
		owner: CartOwner,
	): Promise<CartResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const payload = { cartId, itemId };
		const operation = (tx: Transaction) => this.#removeItem(tx, cartId, itemId);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				`cart:${cartId}:items:${itemId}:delete`,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async validateCart(
		cartId: string,
		owner: CartOwner,
	): Promise<CartValidationResponse> {
		await this.#assertCartAccess(this.#db, cartId, owner);
		const inputs = await this.#readActiveItemInputs(cartId);
		const { failures, snapshots } = await this.#revalidateItems(inputs);

		return this.#db.transaction(async (tx) => {
			await this.#ensureMutableCart(tx, cartId, new Date(), {
				forUpdate: true,
			});
			await this.#assertActiveItemSet(
				tx,
				cartId,
				inputs.map((input) => input.itemId),
			);
			for (const snapshot of snapshots) {
				await this.#insertQuoteSnapshot(tx, snapshot.snapshot);
				await tx
					.update(cartItemTable)
					.set({
						quoteSnapshotId: snapshot.snapshot.id,
						updatedAt: new Date(),
					})
					.where(eq(cartItemTable.id, snapshot.itemId));
			}
			await this.#recalculateCartTotals(tx, cartId, new Date());

			return {
				cart: await this.#cartDto(tx, cartId, new Date()),
				failures,
				valid: failures.length === 0,
			};
		});
	}

	async createDraftOrder(
		input: DraftOrderBody,
		owner: CartOwner,
	): Promise<DraftOrderResponse> {
		await this.#assertCartAccess(this.#db, input.cartId, owner);
		const payload = {
			cartId: input.cartId,
			contact: input.contact,
		};
		const scope = `checkout:draft-order:${input.cartId}`;

		if (input.idempotencyKey) {
			const replay = await this.#readIdempotencyReplay<DraftOrderResponse>(
				scope,
				input.idempotencyKey,
				payload,
			);
			if (replay) {
				return replay;
			}
		}

		const activeItems = await this.#readActiveItemInputs(input.cartId);
		if (activeItems.length === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one home before checkout.",
				422,
			);
		}

		const { failures, snapshots } = await this.#revalidateItems(activeItems);
		if (failures.length > 0) {
			throw new CommerceError(
				"quote_revalidation_failed",
				"One or more cart items need updated dates or guests.",
				409,
				{
					issues: failures.map((failure) => ({
						message: failure.message,
						path: `items.${failure.itemId}`,
					})),
				},
			);
		}

		const discount = await this.#revalidateCartDiscount(input.cartId);

		const operation = (tx: Transaction) =>
			this.#createDraftOrder(tx, input, snapshots, owner, discount);

		if (input.idempotencyKey) {
			return this.#runIdempotent(
				scope,
				input.idempotencyKey,
				payload,
				operation,
			);
		}

		return this.#db.transaction(operation);
	}

	async #createCart(
		tx: Transaction,
		input: CreateCartInput,
		owner: CartOwner,
	): Promise<CartResponse> {
		const now = new Date();

		if (input.cartId) {
			const [existing] = await tx
				.select({ id: cartTable.id })
				.from(cartTable)
				.where(eq(cartTable.id, input.cartId))
				.limit(1);
			if (existing) {
				// A supplied id must not let a caller adopt someone else's cart.
				await this.#assertCartAccess(tx, existing.id, owner);
				return { cart: await this.#cartDto(tx, existing.id, now) };
			}
		}

		const id = input.cartId ?? crypto.randomUUID();
		await tx.insert(cartTable).values({
			cartToken: crypto.randomUUID(),
			createdAt: now,
			currency: this.#currency,
			expiresAt: new Date(now.getTime() + CART_TTL_MS),
			id,
			updatedAt: now,
			userId: owner.userId ?? null,
		});

		return { cart: await this.#cartDto(tx, id, now) };
	}

	async #addItemWithSnapshot(
		tx: Transaction,
		cartId: string,
		input: AddCartItemBody,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<CartMutationResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		await this.#insertQuoteSnapshot(tx, snapshot);

		const existing = input.clientMutationId
			? await this.#findItemByClientMutationId(
					tx,
					cartId,
					input.clientMutationId,
				)
			: null;
		const itemId = existing?.id ?? crypto.randomUUID();

		if (existing) {
			await tx
				.update(cartItemTable)
				.set({
					quoteSnapshotId: snapshot.id,
					removedAt: null,
					status: "active",
					updatedAt: now,
				})
				.where(eq(cartItemTable.id, itemId));
		} else {
			await tx.insert(cartItemTable).values({
				cartId,
				clientMutationId: input.clientMutationId,
				createdAt: now,
				id: itemId,
				position: await this.#nextCartPosition(tx, cartId),
				quoteSnapshotId: snapshot.id,
				status: "active",
				type: "accommodation",
				updatedAt: now,
			});
		}

		await this.#recalculateCartTotals(tx, cartId, now);
		return this.#cartMutationResponse(tx, cartId, itemId, now);
	}

	async #updateItemWithSnapshot(
		tx: Transaction,
		cartId: string,
		itemId: string,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<CartMutationResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		const [item] = await tx
			.select({ id: cartItemTable.id, status: cartItemTable.status })
			.from(cartItemTable)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (item?.status !== "active") {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		await this.#insertQuoteSnapshot(tx, snapshot);
		await tx
			.update(cartItemTable)
			.set({ quoteSnapshotId: snapshot.id, updatedAt: now })
			.where(eq(cartItemTable.id, itemId));
		await this.#recalculateCartTotals(tx, cartId, now);

		return this.#cartMutationResponse(tx, cartId, itemId, now);
	}

	async #removeItem(
		tx: Transaction,
		cartId: string,
		itemId: string,
	): Promise<CartResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });
		const [item] = await tx
			.select({ id: cartItemTable.id, status: cartItemTable.status })
			.from(cartItemTable)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (!item) {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		if (item.status !== "removed") {
			await tx
				.update(cartItemTable)
				.set({ removedAt: now, status: "removed", updatedAt: now })
				.where(eq(cartItemTable.id, itemId));
			await this.#recalculateCartTotals(tx, cartId, now);
		}

		return { cart: await this.#cartDto(tx, cartId, now) };
	}

	async #applyDiscount(
		tx: Transaction,
		cartId: string,
		discount: AppliedDiscountSnapshot,
	): Promise<CartResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, cartId, now, { forUpdate: true });

		const [cartRow] = await tx
			.select({ currency: cartTable.currency })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (
			discount.type === "fixed" &&
			discount.currency &&
			cartRow &&
			discount.currency.toUpperCase() !== cartRow.currency.toUpperCase()
		) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code cannot be applied to this cart.",
				422,
			);
		}

		await tx
			.update(cartTable)
			.set({ appliedDiscount: discount, updatedAt: now })
			.where(eq(cartTable.id, cartId));
		await this.#recalculateCartTotals(tx, cartId, now);

		return { cart: await this.#cartDto(tx, cartId, now) };
	}

	/**
	 * Re-resolves the cart's applied coupon against the provider before checkout,
	 * mirroring quote revalidation, so an expired/deactivated code cannot be
	 * charged. Returns the freshly resolved snapshot, or null when no discount is
	 * applied. Throws `discount_invalid` (409) if the code is no longer valid.
	 */
	async #revalidateCartDiscount(
		cartId: string,
	): Promise<RevalidatedCartDiscount> {
		const [row] = await this.#db
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		const applied = row?.appliedDiscount;
		if (!applied) {
			return { applied: null, resolved: null };
		}

		// Without a promotion code we cannot re-resolve; trust the stored snapshot.
		if (!applied.promotionCode) {
			return { applied, resolved: applied };
		}

		const resolved = await this.#resolveDiscount(applied.promotionCode);
		if (!resolved) {
			throw new CommerceError(
				"discount_invalid",
				"This promotion code is no longer valid.",
				409,
			);
		}

		return { applied, resolved };
	}

	async #createDraftOrder(
		tx: Transaction,
		input: DraftOrderBody,
		snapshots: RevalidatedSnapshot[],
		owner: CartOwner,
		revalidatedDiscount: RevalidatedCartDiscount,
	): Promise<DraftOrderResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, input.cartId, now, { forUpdate: true });
		await this.#assertCartDiscountUnchanged(
			tx,
			input.cartId,
			revalidatedDiscount.applied,
		);
		await this.#assertActiveItemSet(
			tx,
			input.cartId,
			snapshots.map((snapshot) => snapshot.itemId),
		);

		for (const snapshot of snapshots) {
			await this.#insertQuoteSnapshot(tx, snapshot.snapshot);
			await tx
				.update(cartItemTable)
				.set({
					quoteSnapshotId: snapshot.snapshot.id,
					updatedAt: now,
				})
				.where(eq(cartItemTable.id, snapshot.itemId));
		}

		const totals = await this.#recalculateCartTotals(tx, input.cartId, now);
		// A fully-discounted housing cart can legitimately reach total 0; only an
		// item-less cart is empty. (Skipping the PaymentIntent for a zero total is
		// a Milestone-4 concern.)
		if (totals.validItemCount === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one valid home before checkout.",
				422,
			);
		}

		const orderSources = await this.#orderSources(tx, input.cartId, now);
		if (orderSources.length === 0) {
			throw new CommerceError(
				"empty_cart",
				"Add at least one valid home before checkout.",
				422,
			);
		}

		const housingBases = orderSources.map(
			(source) => source.quote.housingFeeMinor,
		);
		const discount = revalidatedDiscount.resolved;
		const housingBaseTotal = housingBases.reduce((sum, base) => sum + base, 0);
		const discountMinor = discount
			? computeDiscountMinor(discount, housingBaseTotal, totals.currency)
			: 0;
		const discountAllocations = allocateDiscountByHousingBase(
			housingBases,
			discountMinor,
		);

		const orderId = crypto.randomUUID();
		const checkoutExpiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);

		const publicReference = await this.#insertOrderWithUniqueReference(
			tx,
			{
				appliedDiscount: discountMinor > 0 ? discount : null,
				cartId: input.cartId,
				checkoutExpiresAt,
				createdAt: now,
				currency: totals.currency,
				discountMinor,
				id: orderId,
				status: "draft",
				subtotalMinor: totals.subtotalMinor,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor - discountMinor,
				updatedAt: now,
				userId: owner.userId ?? null,
			},
			now,
		);

		await tx.insert(orderContactTable).values({
			billingAddress: input.contact.billingAddress,
			companyName: input.contact.companyName,
			createdAt: now,
			email: input.contact.email,
			id: crypto.randomUUID(),
			isCompany: input.contact.isCompany,
			name: input.contact.name,
			notes: input.contact.notes,
			orderId,
			phoneE164: input.contact.phoneE164,
			taxNumber: input.contact.taxNumber,
		});

		for (const [index, source] of orderSources.entries()) {
			const rows = buildDraftOrderRows(source, input.contact);
			const orderItemId = crypto.randomUUID();
			const itemDiscountMinor = discountAllocations[index] ?? 0;
			const charges =
				discount && itemDiscountMinor > 0
					? [
							...rows.charges,
							buildDiscountChargeRow(
								discount,
								itemDiscountMinor,
								rows.charges.length + 1,
							),
						]
					: rows.charges;

			await tx.insert(orderItemTable).values({
				catalogSnapshot: rows.item.catalogSnapshot,
				createdAt: now,
				currency: rows.item.currency,
				discountMinor: itemDiscountMinor,
				id: orderItemId,
				imageUrlSnapshot: rows.item.imageUrlSnapshot,
				orderId,
				position: rows.item.position,
				quantity: rows.item.quantity,
				sourceCartItemId: rows.item.sourceCartItemId,
				status: rows.item.status,
				subtotalMinor: rows.item.subtotalMinor,
				taxMinor: rows.item.taxMinor,
				titleSnapshot: rows.item.titleSnapshot,
				totalMinor: rows.item.totalMinor - itemDiscountMinor,
				type: rows.item.type,
				updatedAt: now,
			});

			await tx.insert(accommodationItemDetailTable).values({
				adults: rows.detail.adults,
				checkIn: rows.detail.checkIn,
				checkOut: rows.detail.checkOut,
				children: rows.detail.children,
				externalAccountId: rows.detail.externalAccountId,
				guests: rows.detail.guests,
				hostifyListingId: rows.detail.hostifyListingId,
				infants: rows.detail.infants,
				nights: rows.detail.nights,
				orderItemId,
				pets: rows.detail.pets,
				propertyTimezone: rows.detail.propertyTimezone,
				provider: rows.detail.provider,
			});

			if (charges.length > 0) {
				await tx.insert(orderItemChargeTable).values(
					charges.map((charge) => ({
						createdAt: now,
						grossMinor: charge.grossMinor,
						id: crypto.randomUUID(),
						kind: charge.kind,
						name: charge.name,
						netMinor: charge.netMinor,
						orderItemId,
						position: charge.position,
						providerChargeId: charge.providerChargeId,
						quantity: charge.quantity,
						rawPayload: charge.rawPayload,
						taxMinor: charge.taxMinor,
						taxRateBasisPoints: charge.taxRateBasisPoints,
						unitNetMinor: charge.unitNetMinor,
					})),
				);
			}
		}

		await tx
			.update(cartTable)
			.set({
				convertedOrderId: orderId,
				status: "converted",
				updatedAt: now,
			})
			.where(eq(cartTable.id, input.cartId));

		return {
			checkoutExpiresAt: checkoutExpiresAt.toISOString(),
			orderId,
			publicReference,
			status: "draft",
		};
	}

	async #fetchQuoteSnapshot(
		input: CommerceQuoteInput,
		requireAvailable: boolean,
	): Promise<NormalizedAccommodationQuoteSnapshot> {
		const quote = await this.#quoteAccommodation(input);
		const snapshot = normalizeAccommodationQuoteSnapshot({
			accountId: this.#accountId,
			provider: this.#provider,
			quote,
			ttlSeconds: this.#quoteTtlSeconds,
		});

		if (requireAvailable && snapshot.validationStatus !== "valid") {
			throw new CommerceError(
				"dates_unavailable",
				"These dates are no longer available.",
				409,
			);
		}

		return snapshot;
	}

	async #revalidateItems(inputs: ActiveItemInput[]): Promise<{
		failures: CartValidationFailure[];
		snapshots: RevalidatedSnapshot[];
	}> {
		const failures: CartValidationFailure[] = [];
		const snapshots: RevalidatedSnapshot[] = [];
		type RevalidationAttempt =
			| {
					input: ActiveItemInput;
					snapshot: NormalizedAccommodationQuoteSnapshot;
					type: "snapshot";
			  }
			| { error: CommerceError; input: ActiveItemInput; type: "failure" };

		const results = await Promise.allSettled(
			inputs.map(async (input): Promise<RevalidationAttempt> => {
				try {
					return {
						input,
						snapshot: await this.#fetchQuoteSnapshot(input.quoteInput, false),
						type: "snapshot",
					};
				} catch (error) {
					if (error instanceof CommerceError) {
						return { error, input, type: "failure" };
					}
					throw error;
				}
			}),
		);

		for (const result of results) {
			if (result.status === "rejected") {
				throw result.reason;
			}

			if (result.value.type === "failure") {
				failures.push({
					code: result.value.error.code,
					itemId: result.value.input.itemId,
					message: result.value.error.message,
				});
				continue;
			}

			const { input, snapshot } = result.value;
			snapshots.push({ itemId: input.itemId, snapshot });
			if (snapshot.validationStatus !== "valid") {
				failures.push({
					code: "dates_unavailable",
					itemId: input.itemId,
					message: "These dates are no longer available.",
				});
			}
		}

		return { failures, snapshots };
	}

	async #insertQuoteSnapshot(
		tx: Transaction,
		snapshot: NormalizedAccommodationQuoteSnapshot,
	): Promise<void> {
		await tx.insert(accommodationQuoteSnapshotTable).values({
			adults: snapshot.adults,
			checkIn: snapshot.checkIn,
			checkOut: snapshot.checkOut,
			children: snapshot.children,
			cleaningFeeMinor: snapshot.cleaningFeeMinor,
			createdAt: new Date(),
			currency: snapshot.currency,
			expiresAt: snapshot.expiresAt,
			externalAccountId: snapshot.externalAccountId,
			feeLines: snapshot.feeLines,
			fetchedAt: snapshot.fetchedAt,
			guests: snapshot.guests,
			housingFeeMinor: snapshot.housingFeeMinor,
			id: snapshot.id,
			infants: snapshot.infants,
			listingExternalId: snapshot.listingExternalId,
			nightlyAverageMinor: snapshot.nightlyAverageMinor,
			nights: snapshot.nights,
			pets: snapshot.pets,
			provider: snapshot.provider,
			providerPayload: snapshot.providerPayload,
			subtotalMinor: snapshot.subtotalMinor,
			taxMinor: snapshot.taxMinor,
			totalMinor: snapshot.totalMinor,
			validationStatus: snapshot.validationStatus,
		});
	}

	/**
	 * Authorizes a cart-scoped operation. Access is granted iff the caller is the
	 * linked user, or the cart is anonymous and the caller presents the matching
	 * secret cart token. Denials throw `cart_not_found` (404) so cart existence
	 * stays unenumerable.
	 */
	async #assertCartAccess(
		db: DbExecutor,
		cartId: string,
		owner: CartOwner,
	): Promise<void> {
		const [row] = await db
			.select({ cartToken: cartTable.cartToken, userId: cartTable.userId })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!row || !isCartAccessGranted(row, owner)) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}
	}

	async #ensureMutableCart(
		db: DbExecutor,
		cartId: string,
		now: Date,
		options: { forUpdate?: boolean } = {},
	): Promise<void> {
		const query = db
			.select({
				expiresAt: cartTable.expiresAt,
				id: cartTable.id,
				status: cartTable.status,
			})
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		// `forUpdate` locks the cart row for the rest of the transaction so the
		// active item set cannot drift between revalidation and conversion.
		const [row] = options.forUpdate ? await query.for("update") : await query;

		assertMutableCart(row, now);
	}

	/**
	 * Reconciles the cart's current active item set against the set that was
	 * revalidated outside the transaction. A concurrent add/remove between the
	 * unlocked read and the locked transaction throws `cart_changed` (409) so the
	 * client retries against fresh state.
	 */
	async #assertActiveItemSet(
		tx: Transaction,
		cartId: string,
		expectedItemIds: string[],
	): Promise<void> {
		const rows = await tx
			.select({ id: cartItemTable.id })
			.from(cartItemTable)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			);

		const actual = new Set(rows.map((row) => row.id));
		const drifted =
			actual.size !== expectedItemIds.length ||
			expectedItemIds.some((itemId) => !actual.has(itemId));

		if (drifted) {
			throw new CommerceError(
				"cart_changed",
				"Your cart changed; please review it and try again.",
				409,
			);
		}
	}

	async #assertCartDiscountUnchanged(
		tx: Transaction,
		cartId: string,
		expected: AppliedDiscountSnapshot | null,
	): Promise<void> {
		const [row] = await tx
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!discountsEqual(row?.appliedDiscount ?? null, expected)) {
			throw new CommerceError(
				"cart_changed",
				"Your cart changed; please review it and try again.",
				409,
			);
		}
	}

	async #readActiveItemInput(
		cartId: string,
		itemId: string,
	): Promise<ActiveItemInput> {
		const now = new Date();
		await this.#ensureMutableCart(this.#db, cartId, now);
		const [row] = await this.#db
			.select({
				adults: accommodationQuoteSnapshotTable.adults,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				children: accommodationQuoteSnapshotTable.children,
				guests: accommodationQuoteSnapshotTable.guests,
				infants: accommodationQuoteSnapshotTable.infants,
				itemId: cartItemTable.id,
				listingId: accommodationQuoteSnapshotTable.listingExternalId,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
				status: cartItemTable.status,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(eq(cartItemTable.id, itemId), eq(cartItemTable.cartId, cartId)),
			)
			.limit(1);

		if (row?.status !== "active") {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		return {
			itemId: row.itemId,
			quoteInput: {
				adults: row.adults,
				children: row.children,
				dates: {
					checkIn: row.checkIn,
					checkOut: row.checkOut,
					nights: row.nights,
				},
				guests: row.guests,
				infants: row.infants,
				listingId: row.listingId,
				pets: row.pets,
			},
		};
	}

	async #readActiveItemInputs(cartId: string): Promise<ActiveItemInput[]> {
		const now = new Date();
		await this.#ensureMutableCart(this.#db, cartId, now);
		const rows = await this.#db
			.select({
				adults: accommodationQuoteSnapshotTable.adults,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				children: accommodationQuoteSnapshotTable.children,
				guests: accommodationQuoteSnapshotTable.guests,
				infants: accommodationQuoteSnapshotTable.infants,
				itemId: cartItemTable.id,
				listingId: accommodationQuoteSnapshotTable.listingExternalId,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			)
			.orderBy(asc(cartItemTable.position));

		return rows.map((row) => ({
			itemId: row.itemId,
			quoteInput: {
				adults: row.adults,
				children: row.children,
				dates: {
					checkIn: row.checkIn,
					checkOut: row.checkOut,
					nights: row.nights,
				},
				guests: row.guests,
				infants: row.infants,
				listingId: row.listingId,
				pets: row.pets,
			},
		}));
	}

	async #findItemByClientMutationId(
		tx: Transaction,
		cartId: string,
		clientMutationId: string,
	): Promise<{ id: string } | null> {
		const [row] = await tx
			.select({ id: cartItemTable.id })
			.from(cartItemTable)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.clientMutationId, clientMutationId),
				),
			)
			.limit(1);

		return row ?? null;
	}

	async #nextCartPosition(tx: Transaction, cartId: string): Promise<number> {
		const [row] = await tx
			.select({
				position: sql<number>`coalesce(max(${cartItemTable.position}), 0)::int`,
			})
			.from(cartItemTable)
			.where(eq(cartItemTable.cartId, cartId));

		return (row?.position ?? 0) + 1;
	}

	async #recalculateCartTotals(
		tx: Transaction,
		cartId: string,
		now: Date,
	): Promise<ReturnType<typeof sumCartTotals>> {
		const rows = await tx
			.select({
				currency: accommodationQuoteSnapshotTable.currency,
				housingFeeMinor: accommodationQuoteSnapshotTable.housingFeeMinor,
				subtotalMinor: accommodationQuoteSnapshotTable.subtotalMinor,
				taxMinor: accommodationQuoteSnapshotTable.taxMinor,
				totalMinor: accommodationQuoteSnapshotTable.totalMinor,
				validationStatus: accommodationQuoteSnapshotTable.validationStatus,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			);

		const totals = sumCartTotals(rows, this.#currency);
		const [cartRow] = await tx
			.select({ appliedDiscount: cartTable.appliedDiscount })
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		const discountMinor = cartRow?.appliedDiscount
			? computeDiscountMinor(
					cartRow.appliedDiscount,
					totals.housingBaseMinor,
					totals.currency,
				)
			: 0;

		await tx
			.update(cartTable)
			.set({
				currency: totals.currency,
				discountMinor,
				itemCount: totals.totalItems,
				subtotalMinor: totals.subtotalMinor,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor - discountMinor,
				updatedAt: now,
			})
			.where(eq(cartTable.id, cartId));

		return totals;
	}

	async #cartMutationResponse(
		tx: Transaction,
		cartId: string,
		itemId: string,
		now: Date,
	): Promise<CartMutationResponse> {
		const cart = await this.#cartDto(tx, cartId, now);
		const item = cart.items.find((cartItem) => cartItem.id === itemId);
		if (!item) {
			throw new CommerceError("item_not_found", "Cart item not found.", 404);
		}

		return { cart, item, quote: item.quote };
	}

	async #cartDto(db: DbExecutor, cartId: string, now: Date): Promise<CartDto> {
		const [row] = await db
			.select()
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		if (!row) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		const items = await this.#cartRows(db, cartId);
		const status =
			row.status === "draft" && row.expiresAt.getTime() <= now.getTime()
				? "expired"
				: toCartStatus(row.status);

		return {
			appliedDiscount: row.appliedDiscount,
			cartToken: row.cartToken,
			createdAt: row.createdAt.toISOString(),
			currency: row.currency,
			discountMinor: row.discountMinor,
			expiresAt: row.expiresAt.toISOString(),
			id: row.id,
			itemCount: row.itemCount,
			items: items.map((item) => toCartItemDto(item, now)),
			status,
			subtotalMinor: row.subtotalMinor,
			taxMinor: row.taxMinor,
			totalMinor: row.totalMinor,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	async #cartRows(db: DbExecutor, cartId: string): Promise<CartJoinedRow[]> {
		return db
			.select({
				cartItemId: cartItemTable.id,
				checkIn: accommodationQuoteSnapshotTable.checkIn,
				checkOut: accommodationQuoteSnapshotTable.checkOut,
				city: accommodationListingTable.city,
				country: accommodationListingTable.country,
				currency: accommodationQuoteSnapshotTable.currency,
				externalAccountId: accommodationQuoteSnapshotTable.externalAccountId,
				feeLines: accommodationQuoteSnapshotTable.feeLines,
				fetchedAt: accommodationQuoteSnapshotTable.fetchedAt,
				guests: accommodationQuoteSnapshotTable.guests,
				housingFeeMinor: accommodationQuoteSnapshotTable.housingFeeMinor,
				imageFallbackName: accommodationListingTable.name,
				infants: accommodationQuoteSnapshotTable.infants,
				itemStatus: cartItemTable.status,
				listingExternalId: accommodationQuoteSnapshotTable.listingExternalId,
				nightlyAverageMinor:
					accommodationQuoteSnapshotTable.nightlyAverageMinor,
				nights: accommodationQuoteSnapshotTable.nights,
				pets: accommodationQuoteSnapshotTable.pets,
				position: cartItemTable.position,
				processed: accommodationListingTable.processed,
				provider: accommodationQuoteSnapshotTable.provider,
				providerPayload: accommodationQuoteSnapshotTable.providerPayload,
				quoteAdults: accommodationQuoteSnapshotTable.adults,
				quoteChildren: accommodationQuoteSnapshotTable.children,
				quoteCleaningFeeMinor: accommodationQuoteSnapshotTable.cleaningFeeMinor,
				quoteExpiresAt: accommodationQuoteSnapshotTable.expiresAt,
				quoteId: accommodationQuoteSnapshotTable.id,
				quoteStatus: accommodationQuoteSnapshotTable.validationStatus,
				raw: accommodationListingTable.raw,
				subtotalMinor: accommodationQuoteSnapshotTable.subtotalMinor,
				taxMinor: accommodationQuoteSnapshotTable.taxMinor,
				timezone: accommodationListingTable.timezone,
				totalMinor: accommodationQuoteSnapshotTable.totalMinor,
				updatedAt: cartItemTable.updatedAt,
			})
			.from(cartItemTable)
			.innerJoin(
				accommodationQuoteSnapshotTable,
				eq(cartItemTable.quoteSnapshotId, accommodationQuoteSnapshotTable.id),
			)
			.leftJoin(
				accommodationListingTable,
				and(
					eq(
						accommodationListingTable.provider,
						accommodationQuoteSnapshotTable.provider,
					),
					eq(
						accommodationListingTable.externalAccountId,
						accommodationQuoteSnapshotTable.externalAccountId,
					),
					eq(
						accommodationListingTable.externalId,
						accommodationQuoteSnapshotTable.listingExternalId,
					),
				),
			)
			.where(
				and(
					eq(cartItemTable.cartId, cartId),
					eq(cartItemTable.status, "active"),
				),
			)
			.orderBy(asc(cartItemTable.position));
	}

	async #orderSources(
		tx: Transaction,
		cartId: string,
		now: Date,
	): Promise<
		{
			cartItemId: string;
			position: number;
			quote: NormalizedAccommodationQuoteSnapshot;
			snapshot: ListingDisplaySnapshot;
		}[]
	> {
		const rows = await this.#cartRows(tx, cartId);
		const sources = [];

		for (const row of rows) {
			const quote = quoteSnapshotFromRow(row);
			if (
				quote.validationStatus !== "valid" ||
				quote.expiresAt.getTime() <= now.getTime()
			) {
				throw new CommerceError(
					"quote_expired",
					"One or more cart items need a fresh quote.",
					409,
				);
			}

			sources.push({
				cartItemId: row.cartItemId,
				position: row.position,
				quote,
				snapshot: listingSnapshot(row),
			});
		}

		return sources;
	}

	/**
	 * Inserts the order row, generating the public reference at insert time and
	 * letting the unique index settle collisions: a 23505 on a savepoint rolls
	 * back just that attempt (not the outer transaction) and we retry with a
	 * fresh reference. Atomic where a check-then-insert was racy.
	 */
	async #insertOrderWithUniqueReference(
		tx: Transaction,
		values: Omit<typeof orderTable.$inferInsert, "publicReference">,
		now: Date,
	): Promise<string> {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const publicReference = generatePublicOrderReference(now);
			try {
				await tx.transaction(async (savepoint) => {
					await savepoint
						.insert(orderTable)
						.values({ ...values, publicReference });
				});
				return publicReference;
			} catch (error) {
				if (isPublicReferenceConflict(error)) {
					continue;
				}
				throw error;
			}
		}

		throw new CommerceError(
			"order_reference_unavailable",
			"Could not generate a unique order reference.",
			500,
		);
	}

	async #readIdempotencyReplay<T>(
		scope: string,
		key: string,
		payload: unknown,
		db: DbExecutor = this.#db,
	): Promise<T | null> {
		const requestHash = hashIdempotencyRequest(payload);
		const [existing] = await db
			.select({
				requestHash: apiIdempotencyKeyTable.requestHash,
				responseSnapshot: apiIdempotencyKeyTable.responseSnapshot,
				status: apiIdempotencyKeyTable.status,
			})
			.from(apiIdempotencyKeyTable)
			.where(
				and(
					eq(apiIdempotencyKeyTable.scope, scope),
					eq(apiIdempotencyKeyTable.key, key),
					gt(apiIdempotencyKeyTable.expiresAt, new Date()),
				),
			)
			.limit(1);

		if (!existing) {
			return null;
		}

		const expectedHash = Buffer.from(existing.requestHash);
		const actualHash = Buffer.from(requestHash);
		if (
			expectedHash.length !== actualHash.length ||
			!timingSafeEqual(expectedHash, actualHash)
		) {
			throw new CommerceError(
				"idempotency_key_reused",
				"This idempotency key was already used with a different request.",
				409,
			);
		}

		if (existing.status === "completed" && existing.responseSnapshot) {
			return existing.responseSnapshot as T;
		}

		throw new CommerceError(
			"idempotency_in_progress",
			"This idempotent request is still being processed.",
			409,
		);
	}

	async #runIdempotent<T>(
		scope: string,
		key: string,
		payload: unknown,
		operation: (tx: Transaction) => Promise<T>,
	): Promise<T> {
		const requestHash = hashIdempotencyRequest(payload);

		return this.#db.transaction(async (tx) => {
			const now = new Date();
			await tx
				.delete(apiIdempotencyKeyTable)
				.where(
					and(
						eq(apiIdempotencyKeyTable.scope, scope),
						eq(apiIdempotencyKeyTable.key, key),
						lte(apiIdempotencyKeyTable.expiresAt, now),
					),
				);

			const [inserted] = await tx
				.insert(apiIdempotencyKeyTable)
				.values({
					createdAt: now,
					expiresAt: idempotencyExpiresAt(now),
					id: crypto.randomUUID(),
					key,
					requestHash,
					scope,
					status: "in_progress",
					updatedAt: now,
				})
				.onConflictDoNothing()
				.returning({ id: apiIdempotencyKeyTable.id });

			if (!inserted) {
				const replay = await this.#readIdempotencyReplay<T>(
					scope,
					key,
					payload,
					tx,
				);
				if (replay) {
					return replay;
				}
				throw new CommerceError(
					"idempotency_in_progress",
					"This idempotent request is still being processed.",
					409,
				);
			}

			const response = await operation(tx);
			await tx
				.update(apiIdempotencyKeyTable)
				.set({
					responseSnapshot: response,
					status: "completed",
					updatedAt: new Date(),
				})
				.where(eq(apiIdempotencyKeyTable.id, inserted.id));

			return response;
		});
	}
}

function constantTimeEquals(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) {
		return false;
	}
	return timingSafeEqual(aBuffer, bBuffer);
}

function discountsEqual(
	first: AppliedDiscountSnapshot | null,
	second: AppliedDiscountSnapshot | null,
): boolean {
	if (!first || !second) {
		return first === second;
	}

	return (
		first.amountMinor === second.amountMinor &&
		first.couponId === second.couponId &&
		first.currency === second.currency &&
		first.percentBasisPoints === second.percentBasisPoints &&
		first.promotionCode === second.promotionCode &&
		first.source === second.source &&
		first.type === second.type
	);
}

/**
 * Pure access decision for a cart. Granted iff the caller is the linked user,
 * or the cart is anonymous and the caller presents the matching secret token
 * (compared in constant time). Exported for unit testing the access matrix.
 */
export function isCartAccessGranted(
	cart: { cartToken: string; userId: string | null },
	owner: CartOwner,
): boolean {
	if (cart.userId) {
		return owner.userId !== null && owner.userId === cart.userId;
	}
	return (
		owner.cartToken !== null &&
		constantTimeEquals(owner.cartToken, cart.cartToken)
	);
}

/**
 * Access decision for an order. Mirrors {@link isCartAccessGranted}, but the
 * anonymous token is read from the order's originating cart (joined in) and may
 * be absent if that cart was pruned, in which case only the linked user counts.
 */
export function isOrderAccessGranted(
	order: { cartToken: string | null; userId: string | null },
	owner: CartOwner,
): boolean {
	if (order.userId) {
		return owner.userId !== null && owner.userId === order.userId;
	}
	return (
		owner.cartToken !== null &&
		order.cartToken !== null &&
		constantTimeEquals(owner.cartToken, order.cartToken)
	);
}

/** Walks the error cause chain for a Postgres error code + constraint. */
function findPostgresError(
	error: unknown,
): { code: string; constraint?: string } | null {
	let current: unknown = error;
	for (let depth = 0; depth < 6; depth += 1) {
		if (!current || typeof current !== "object") {
			return null;
		}
		const record = current as Record<string, unknown>;
		if (typeof record.code === "string") {
			return {
				code: record.code,
				constraint:
					typeof record.constraint === "string" ? record.constraint : undefined,
			};
		}
		current = record.cause;
	}
	return null;
}

function isPublicReferenceConflict(error: unknown): boolean {
	const pgError = findPostgresError(error);
	return (
		pgError?.code === "23505" &&
		(pgError.constraint === undefined ||
			pgError.constraint === "orders_public_reference_uidx")
	);
}

function mergeQuoteInput(
	current: CommerceQuoteInput,
	update: UpdateCartItemBody,
): CommerceQuoteInput {
	const parsed = parseQuoteBody({
		adults: update.adults ?? current.adults,
		checkIn: update.checkIn ?? current.dates.checkIn,
		checkOut: update.checkOut ?? current.dates.checkOut,
		children: update.children ?? current.children,
		forceFresh: true,
		guests: update.guests ?? current.guests,
		infants: update.infants ?? current.infants,
		listingId: update.listingId ?? current.listingId,
		pets: update.pets ?? current.pets,
	});

	if (!parsed.success) {
		throw invalidRequest(
			"Invalid cart item update",
			parsed.error.issues.map((issue) => ({
				message: issue.message,
				path: issue.path.join("."),
			})),
		);
	}

	return parsed.data;
}

function toCartItemDto(row: CartJoinedRow, now: Date): CartItemDto {
	const snapshot = listingSnapshot(row);
	const quote = quoteDto(row, now);

	return {
		adults: row.quoteAdults,
		checkIn: row.checkIn,
		checkOut: row.checkOut,
		children: row.quoteChildren,
		currency: row.currency,
		guests: row.guests,
		id: row.cartItemId,
		imageUrl: snapshot.imageUrl,
		infants: row.infants,
		listingId: row.listingExternalId,
		nights: row.nights,
		pets: row.pets,
		position: row.position,
		quote,
		status: "active",
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		title: snapshot.title,
		totalMinor: row.totalMinor,
		type: "accommodation",
		updatedAt: row.updatedAt.toISOString(),
	};
}

function quoteDto(row: CartJoinedRow, now: Date): CommerceQuoteDto {
	const status = quoteStatus(row, now);
	return {
		currency: row.currency,
		expiresAt: row.quoteExpiresAt.toISOString(),
		feeLines: row.feeLines,
		fetchedAt: row.fetchedAt.toISOString(),
		id: row.quoteId,
		status,
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
	};
}

function quoteSnapshotFromRow(
	row: CartJoinedRow,
): NormalizedAccommodationQuoteSnapshot {
	return {
		adults: row.quoteAdults,
		checkIn: row.checkIn,
		checkOut: row.checkOut,
		children: row.quoteChildren,
		cleaningFeeMinor: row.quoteCleaningFeeMinor,
		currency: row.currency,
		expiresAt: row.quoteExpiresAt,
		externalAccountId: row.externalAccountId,
		feeLines: row.feeLines,
		fetchedAt: row.fetchedAt,
		guests: row.guests,
		housingFeeMinor: row.housingFeeMinor ?? housingFeeMinor(row.feeLines),
		id: row.quoteId,
		infants: row.infants,
		listingExternalId: row.listingExternalId,
		nightlyAverageMinor: row.nightlyAverageMinor,
		nights: row.nights,
		pets: row.pets,
		provider: row.provider,
		providerPayload: row.providerPayload ?? {},
		subtotalMinor: row.subtotalMinor,
		taxMinor: row.taxMinor,
		totalMinor: row.totalMinor,
		validationStatus: row.quoteStatus as QuoteValidationStatus,
	};
}

function quoteStatus(row: CartJoinedRow, now: Date): QuoteValidationStatus {
	if (
		row.quoteStatus === "valid" &&
		row.quoteExpiresAt.getTime() <= now.getTime()
	) {
		return "expired";
	}
	if (
		row.quoteStatus === "unavailable" ||
		row.quoteStatus === "provider_error" ||
		row.quoteStatus === "expired"
	) {
		return row.quoteStatus;
	}
	return "valid";
}

function listingSnapshot(row: CartJoinedRow): ListingDisplaySnapshot {
	const title = pickTitle(
		row.processed,
		row.imageFallbackName,
		row.listingExternalId,
	);

	return {
		city: row.city,
		country: row.country,
		imageUrl: extractCoverPhoto(row.raw),
		listingId: row.listingExternalId,
		locationLabel: [row.city, row.country].filter(Boolean).join(", ") || null,
		propertyTimezone: row.timezone ?? DEFAULT_PROPERTY_TIMEZONE,
		provider: row.provider,
		title,
	};
}

function pickTitle(
	processed: AccommodationListingProcessedContent | null,
	fallbackName: string | null,
	listingId: string,
): string {
	const localized = processed?.title;
	return (
		localized?.en?.trim() ||
		localized?.pt?.trim() ||
		localized?.es?.trim() ||
		fallbackName?.trim() ||
		listingId
	);
}

function extractCoverPhoto(
	raw: AccommodationListingRawContent | null,
): string | null {
	if (!raw || !Array.isArray(raw.photos)) {
		return null;
	}

	for (const photo of raw.photos) {
		if (!isRecord(photo)) {
			continue;
		}
		const url = readString(photo.photo) ?? readString(photo.original_file);
		if (url) {
			return url;
		}
	}

	return null;
}

function readString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
