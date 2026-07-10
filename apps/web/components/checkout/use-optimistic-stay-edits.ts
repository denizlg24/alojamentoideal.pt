"use client";

import type {
	CartDto,
	CartItemDto,
	CartValidationResponse,
} from "@workspace/core/commerce";
import { type Dispatch, type SetStateAction, useRef } from "react";
import { nightsBetween } from "@/lib/catalog/dates";
import { capacityForGuests } from "@/lib/catalog/guests";
import * as api from "@/lib/checkout/api-client";
import { toCheckoutError } from "@/lib/checkout/errors";
import { randomIdempotencyKey } from "@/lib/checkout/idempotency";

export interface GuestSelection {
	adults: number;
	children: number;
	infants: number;
}

export interface EditStayValue extends GuestSelection {
	checkIn: string;
	checkOut: string;
}

interface UseOptimisticStayEditsArgs {
	cart: CartDto | null;
	setCart: Dispatch<SetStateAction<CartDto | null>>;
	/** Reconciles the authoritative server cart (sets cart, failures, badge). */
	applyValidated: (
		validated: CartValidationResponse,
		options?: { force?: boolean },
	) => unknown;
	onError: (message: string) => void;
	/**
	 * Repricing ids live in the view so it can block checkout until validation;
	 * the hook owns them through this setter as the single source of pending edits.
	 */
	setRepricingItemIds: Dispatch<SetStateAction<Set<string>>>;
	/**
	 * Broadcasts an optimistic cart to the header badge before the server commit.
	 * The view keeps its applied-fingerprint ref in sync here so its own
	 * cart-changed listener does not treat the broadcast as an external change and
	 * roll the optimistic edit back.
	 */
	onOptimisticCart?: (cart: CartDto) => void;
}

export interface OptimisticStayEdits {
	/** Applies new dates + guests instantly, then commits in one request. */
	patchStay: (itemId: string, next: EditStayValue) => void;
	/** Removes the stay instantly, then commits. */
	removeStay: (itemId: string) => void;
}

function withRepricing(
	set: Dispatch<SetStateAction<Set<string>>>,
	itemId: string,
): void {
	set((current) => {
		if (current.has(itemId)) {
			return current;
		}
		const next = new Set(current);
		next.add(itemId);
		return next;
	});
}

function clearRepricing(
	set: Dispatch<SetStateAction<Set<string>>>,
	itemId: string,
): void {
	set((current) => {
		if (!current.has(itemId)) {
			return current;
		}
		const next = new Set(current);
		next.delete(itemId);
		return next;
	});
}

/**
 * Optimistic engine for stay edits on a cart. Each edit patches the local cart
 * immediately (so the dialog can close without waiting on the network) and marks
 * the item as repricing until the server re-quote lands. A per-item generation
 * guard drops stale responses
 * when a newer edit for the same item is in flight, and any failed edit re-reads
 * the server cart to roll the optimistic patch back to the truth.
 */
export function useOptimisticStayEdits({
	cart,
	setCart,
	applyValidated,
	onError,
	setRepricingItemIds,
	onOptimisticCart,
}: UseOptimisticStayEditsArgs): OptimisticStayEdits {
	// Latest cart, read inside async commits to avoid stale closures.
	const cartRef = useRef(cart);
	cartRef.current = cart;

	// Monotonic generation per item; only the latest commit may reconcile.
	const generationRef = useRef<Map<string, number>>(new Map());

	const bumpGeneration = (itemId: string): number => {
		const next = (generationRef.current.get(itemId) ?? 0) + 1;
		generationRef.current.set(itemId, next);
		return next;
	};

	const commit = async (
		itemId: string,
		rollbackCart: CartDto,
		mutation: (cartId: string) => Promise<unknown>,
	): Promise<void> => {
		const cartId = rollbackCart.id;
		if (!cartId) {
			return;
		}
		const generation = bumpGeneration(itemId);
		try {
			await mutation(cartId);
			const validated = await api.validateCart(cartId);
			// A newer edit for this item superseded us; let it reconcile instead.
			if (generationRef.current.get(itemId) !== generation) {
				return;
			}
			applyValidated(validated);
			clearRepricing(setRepricingItemIds, itemId);
		} catch (error) {
			if (generationRef.current.get(itemId) !== generation) {
				return;
			}
			onError(toCheckoutError(error).message);
			// Roll the optimistic patch back to the server truth.
			try {
				applyValidated(await api.validateCart(cartId), { force: true });
			} catch {
				setCart(rollbackCart);
				onOptimisticCart?.(rollbackCart);
			}
			clearRepricing(setRepricingItemIds, itemId);
		}
	};

	const patchItem = (
		current: CartDto,
		itemId: string,
		patch: (item: CartItemDto) => CartItemDto,
	): CartDto => {
		return {
			...current,
			items: current.items.map((item) =>
				item.id === itemId && item.type === "accommodation"
					? patch(item)
					: item,
			),
		};
	};

	const patchStay: OptimisticStayEdits["patchStay"] = (itemId, next) => {
		const rollbackCart = cartRef.current;
		if (!rollbackCart) {
			return;
		}
		const guests = capacityForGuests(next.adults, next.children);
		const optimisticCart = patchItem(rollbackCart, itemId, (item) => ({
			...item,
			adults: next.adults,
			checkIn: next.checkIn,
			checkOut: next.checkOut,
			children: next.children,
			guests,
			infants: next.infants,
			nights: nightsBetween(next.checkIn, next.checkOut),
		}));
		withRepricing(setRepricingItemIds, itemId);
		setCart(optimisticCart);
		onOptimisticCart?.(optimisticCart);
		void commit(itemId, rollbackCart, (cartId) =>
			api.updateCartItem(cartId, itemId, {
				adults: next.adults,
				checkIn: next.checkIn,
				checkOut: next.checkOut,
				children: next.children,
				guests,
				idempotencyKey: randomIdempotencyKey("stay"),
				infants: next.infants,
			}),
		);
	};

	const removeStay: OptimisticStayEdits["removeStay"] = (itemId) => {
		const rollbackCart = cartRef.current;
		if (!rollbackCart) {
			return;
		}
		// Keep the item id pending while the server re-quotes the remaining stays,
		// even though this card is already gone locally.
		withRepricing(setRepricingItemIds, itemId);
		const removedItem = rollbackCart.items.find((item) => item.id === itemId);
		const optimisticCart: CartDto = {
			...rollbackCart,
			itemCount: Math.max(0, rollbackCart.itemCount - 1),
			items: rollbackCart.items.filter((item) => item.id !== itemId),
			subtotalMinor: Math.max(
				0,
				rollbackCart.subtotalMinor - (removedItem?.subtotalMinor ?? 0),
			),
			taxMinor: Math.max(
				0,
				rollbackCart.taxMinor - (removedItem?.taxMinor ?? 0),
			),
			totalMinor: Math.max(
				0,
				rollbackCart.totalMinor - (removedItem?.totalMinor ?? 0),
			),
		};
		setCart(optimisticCart);
		// Drop the header badge immediately rather than waiting on the server.
		onOptimisticCart?.(optimisticCart);
		void commit(itemId, rollbackCart, (cartId) =>
			api.removeCartItem(cartId, itemId, randomIdempotencyKey("remove")),
		);
	};

	return { patchStay, removeStay };
}
