import type { CartDto } from "@workspace/core/commerce";
import * as api from "./api-client";
import { CHECKOUT_CART_STORAGE_KEY } from "./api-client";
import { toCheckoutError } from "./errors";
import {
	cartItemClientMutationId,
	cartItemIdempotencyKey,
	type StayKeyInput,
} from "./idempotency";

/**
 * Client-side handle on the visitor's one shared cart. The authoritative cart
 * token lives in the httpOnly `ai_cart` cookie; this module only remembers the
 * cart id (so reloads and new tabs converge on the same cart instead of
 * spawning a fresh one) and broadcasts item-count changes so the header badge
 * stays live without polling.
 */

/** localStorage key for the shared cart id (persists across sessions). */
export const CART_ID_STORAGE_KEY = "ai_cart_id";

/**
 * localStorage cache of the active item count, so the header badge can paint
 * instantly on load and sync across tabs via the `storage` event.
 */
const CART_COUNT_STORAGE_KEY = "ai_cart_count";

/**
 * localStorage cache of a fingerprint of the cart's active contents. The
 * `/cart` and `/checkout` routes key their client views on this so a cart
 * whose contents changed remounts them with fresh data. With cacheComponents,
 * Next.js keeps visited routes alive with React `<Activity>` instead of
 * unmounting them, so the bare item count misses content changes that keep
 * the count stable (remove one stay, add another; edit dates or guests) and
 * the revived view would keep showing the old cart.
 */
const CART_FINGERPRINT_STORAGE_KEY = "ai_cart_fingerprint";

/** Fingerprint of a cart with no active stays. */
const EMPTY_CART_FINGERPRINT = "0";

/** Same-tab CustomEvent fired whenever a cart mutation settles. */
export const CART_CHANGED_EVENT = "ai:cart-changed";

export interface CartChangedDetail {
	itemCount: number;
}

interface LoadStoredCartOptions {
	notify?: boolean;
}

function hasWindow(): boolean {
	return typeof window !== "undefined";
}

export function activeItemCount(cart: CartDto | null): number {
	if (cart?.status !== "draft") {
		return 0;
	}
	return cart.items.filter((item) => item.status === "active").length;
}

/**
 * Stable, order-insensitive fingerprint of the cart's active stays. Changes
 * whenever a stay is added, removed or edited (dates or guests); deliberately
 * ignores price-only quote refreshes so background revalidation does not churn
 * the route key and force pointless remounts.
 */
export function cartContentFingerprint(cart: CartDto | null): string {
	if (cart?.status !== "draft") {
		return EMPTY_CART_FINGERPRINT;
	}
	const parts = cart.items
		.filter((item) => item.status === "active")
		.map((item) =>
			[
				item.id,
				item.listingId,
				item.checkIn,
				item.checkOut,
				item.adults,
				item.children,
				item.infants,
				item.guests,
			].join("|"),
		)
		.sort();
	return parts.length === 0 ? EMPTY_CART_FINGERPRINT : parts.join(";");
}

export function readStoredCartId(): string | null {
	if (!hasWindow()) {
		return null;
	}
	const stored = window.localStorage.getItem(CART_ID_STORAGE_KEY);
	if (stored) {
		return stored;
	}
	// Migrate the id the single-stay checkout kept in sessionStorage, so a
	// visitor mid-flow when this shipped keeps their cart.
	const legacy = window.sessionStorage.getItem(CHECKOUT_CART_STORAGE_KEY);
	if (legacy) {
		window.localStorage.setItem(CART_ID_STORAGE_KEY, legacy);
	}
	return legacy;
}

export function storeCartId(cartId: string): void {
	if (!hasWindow()) {
		return;
	}
	window.localStorage.setItem(CART_ID_STORAGE_KEY, cartId);
	// Keep the legacy key in step while both stores exist in the wild.
	window.sessionStorage.setItem(CHECKOUT_CART_STORAGE_KEY, cartId);
}

export function clearStoredCart(): void {
	if (!hasWindow()) {
		return;
	}
	window.localStorage.removeItem(CART_ID_STORAGE_KEY);
	window.sessionStorage.removeItem(CHECKOUT_CART_STORAGE_KEY);
	writeCachedItemCount(0);
	writeCachedFingerprint(EMPTY_CART_FINGERPRINT);
	dispatchCartChanged(0);
}

export function readCachedItemCount(): number {
	if (!hasWindow()) {
		return 0;
	}
	const raw = window.localStorage.getItem(CART_COUNT_STORAGE_KEY);
	const parsed = raw ? Number.parseInt(raw, 10) : 0;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Reads the cached fingerprint of the cart's active contents. The `/cart` and
 * `/checkout` views compare this against the fingerprint they last reconciled
 * to decide whether a cart changed elsewhere (another tab, or the checkout flow)
 * and needs an in-place refresh, without remounting mid-edit.
 */
export function readStoredCartFingerprint(): string {
	return readCachedFingerprint() ?? EMPTY_CART_FINGERPRINT;
}

function writeCachedItemCount(count: number): void {
	if (!hasWindow()) {
		return;
	}
	if (count > 0) {
		window.localStorage.setItem(CART_COUNT_STORAGE_KEY, String(count));
	} else {
		window.localStorage.removeItem(CART_COUNT_STORAGE_KEY);
	}
}

function readCachedFingerprint(): string | null {
	if (!hasWindow()) {
		return null;
	}
	return window.localStorage.getItem(CART_FINGERPRINT_STORAGE_KEY);
}

function writeCachedFingerprint(fingerprint: string): void {
	if (!hasWindow()) {
		return;
	}
	if (fingerprint === EMPTY_CART_FINGERPRINT) {
		window.localStorage.removeItem(CART_FINGERPRINT_STORAGE_KEY);
	} else {
		window.localStorage.setItem(CART_FINGERPRINT_STORAGE_KEY, fingerprint);
	}
}

function dispatchCartChanged(itemCount: number): void {
	if (!hasWindow()) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent<CartChangedDetail>(CART_CHANGED_EVENT, {
			detail: { itemCount },
		}),
	);
}

/** Records the cart's current state and tells the header badge about it. */
export function notifyCartChanged(cart: CartDto | null): void {
	const count = activeItemCount(cart);
	writeCachedItemCount(count);
	writeCachedFingerprint(cartContentFingerprint(cart));
	dispatchCartChanged(count);
}

/**
 * Loads the stored shared cart, if any. A missing, inaccessible or non-draft
 * cart clears the stored id and reports an empty cart rather than throwing:
 * every caller treats that as "start fresh".
 */
export async function loadStoredCart(
	options: LoadStoredCartOptions = {},
): Promise<CartDto | null> {
	const storedId = readStoredCartId();
	if (!storedId) {
		return null;
	}
	const shouldNotify = options.notify ?? true;
	try {
		const { cart } = await api.getCart(storedId);
		if (cart.status !== "draft") {
			clearStoredCart();
			return null;
		}
		if (shouldNotify) {
			notifyCartChanged(cart);
		}
		return cart;
	} catch (error) {
		const err = toCheckoutError(error);
		if (err.code === "cart_expired" || err.code === "cart_not_found") {
			clearStoredCart();
		}
		return null;
	}
}

/** Returns the shared draft cart, creating one when none is usable. */
export async function ensureCart(): Promise<CartDto> {
	const existing = await loadStoredCart();
	if (existing) {
		return existing;
	}
	const { cart } = await api.createCart();
	storeCartId(cart.id);
	notifyCartChanged(cart);
	return cart;
}

/**
 * Adds one stay to the shared cart. The deterministic idempotency key and
 * client mutation id mean re-adding the exact same stay dedupes server-side
 * instead of stacking a duplicate item.
 */
export async function addStayToCart(stay: StayKeyInput): Promise<CartDto> {
	const cart = await ensureCart();
	const mutation = await api.addCartItem(cart.id, {
		adults: stay.adults,
		checkIn: stay.checkIn,
		checkOut: stay.checkOut,
		children: stay.children,
		clientMutationId: cartItemClientMutationId(stay),
		guests: stay.guests,
		idempotencyKey: cartItemIdempotencyKey(stay),
		infants: stay.infants,
		listingId: stay.listingId,
	});
	notifyCartChanged(mutation.cart);
	return mutation.cart;
}
