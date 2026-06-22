import { timingSafeEqual } from "node:crypto";
import {
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
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
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { parseQuoteBody } from "../accommodations";
import { CommerceError, invalidRequest } from "./errors";
import { hashIdempotencyRequest, idempotencyExpiresAt } from "./idempotency";
import { normalizeAccommodationQuoteSnapshot } from "./money";
import { buildDraftOrderRows, generatePublicOrderReference } from "./orders";
import type {
	AddCartItemBody,
	DeleteCartItemBody,
	DraftOrderBody,
	UpdateCartItemBody,
} from "./schemas";
import { assertMutableCart, toCartStatus } from "./state";
import { sumCartTotals } from "./totals";
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

	constructor(options: CommerceServiceOptions) {
		this.#accountId = options.accountId;
		this.#currency = options.currency;
		this.#db = options.db;
		this.#provider = options.provider;
		this.#quoteAccommodation = options.quoteAccommodation;
		this.#quoteTtlSeconds = options.quoteTtlSeconds;
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
		input: DeleteCartItemBody = {},
		owner: CartOwner = { cartToken: null, userId: null },
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
			await this.#ensureMutableCart(tx, cartId, new Date());
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

		const operation = (tx: Transaction) =>
			this.#createDraftOrder(tx, input, snapshots, owner);

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
		await this.#ensureMutableCart(tx, cartId, now);
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
		await this.#ensureMutableCart(tx, cartId, now);
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
		await this.#ensureMutableCart(tx, cartId, now);
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

	async #createDraftOrder(
		tx: Transaction,
		input: DraftOrderBody,
		snapshots: RevalidatedSnapshot[],
		owner: CartOwner,
	): Promise<DraftOrderResponse> {
		const now = new Date();
		await this.#ensureMutableCart(tx, input.cartId, now);

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
		if (totals.validItemCount === 0 || totals.totalMinor <= 0) {
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

		const orderId = crypto.randomUUID();
		const publicReference = await this.#uniquePublicReference(tx, now);
		const checkoutExpiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);

		await tx.insert(orderTable).values({
			cartId: input.cartId,
			checkoutExpiresAt,
			createdAt: now,
			currency: totals.currency,
			id: orderId,
			publicReference,
			status: "draft",
			subtotalMinor: totals.subtotalMinor,
			taxMinor: totals.taxMinor,
			totalMinor: totals.totalMinor,
			updatedAt: now,
			userId: owner.userId ?? null,
		});

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

		for (const source of orderSources) {
			const rows = buildDraftOrderRows(source, input.contact);
			const orderItemId = crypto.randomUUID();

			await tx.insert(orderItemTable).values({
				catalogSnapshot: rows.item.catalogSnapshot,
				createdAt: now,
				currency: rows.item.currency,
				discountMinor: rows.item.discountMinor,
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
				totalMinor: rows.item.totalMinor,
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

			if (rows.charges.length > 0) {
				await tx.insert(orderItemChargeTable).values(
					rows.charges.map((charge) => ({
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

		if (!row) {
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		if (row.userId) {
			if (owner.userId && owner.userId === row.userId) {
				return;
			}
			throw new CommerceError("cart_not_found", "Cart not found.", 404);
		}

		if (owner.cartToken && constantTimeEquals(owner.cartToken, row.cartToken)) {
			return;
		}

		throw new CommerceError("cart_not_found", "Cart not found.", 404);
	}

	async #ensureMutableCart(
		db: DbExecutor,
		cartId: string,
		now: Date,
	): Promise<void> {
		const [row] = await db
			.select({
				expiresAt: cartTable.expiresAt,
				id: cartTable.id,
				status: cartTable.status,
			})
			.from(cartTable)
			.where(eq(cartTable.id, cartId))
			.limit(1);

		assertMutableCart(row, now);
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
		await tx
			.update(cartTable)
			.set({
				currency: totals.currency,
				itemCount: totals.totalItems,
				subtotalMinor: totals.subtotalMinor,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor,
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

	async #uniquePublicReference(tx: Transaction, now: Date): Promise<string> {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const reference = generatePublicOrderReference(now);
			const [existing] = await tx
				.select({ id: orderTable.id })
				.from(orderTable)
				.where(eq(orderTable.publicReference, reference))
				.limit(1);
			if (!existing) {
				return reference;
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
	): Promise<T | null> {
		const requestHash = hashIdempotencyRequest(payload);
		const [existing] = await this.#db
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
				),
			)
			.limit(1);

		if (!existing) {
			return null;
		}

		if (existing.requestHash !== requestHash) {
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
