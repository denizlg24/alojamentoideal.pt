/**
 * Non-secret checkout resume metadata. After a draft order exists the cart is
 * frozen server-side, so on reload we resume the payable order rather than
 * dead-ending on the converted cart. Only references are stored here; never
 * client secrets, PaymentIntent ids, cart tokens or any guest PII (the
 * authoritative cart token stays in the httpOnly `ai_cart` cookie).
 */

export interface CheckoutResumeState {
	cartId: string;
	checkoutExpiresAt: string | null;
	orderId: string;
	publicReference: string;
}

export const CHECKOUT_RESUME_STORAGE_KEY = "ai_checkout_resume";

export interface StayKeyParts {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	guests: number;
	infants: number;
	listingId: string;
	pets: number;
}

/**
 * Stable token identifying one stay. Used to check whether a cart already
 * holds the stay a booking route arrived with before adding it again.
 */
export function stayKeyToken(stay: StayKeyParts): string {
	return [
		stay.listingId,
		stay.checkIn,
		stay.checkOut,
		stay.adults,
		stay.children,
		stay.infants,
		stay.pets,
		stay.guests,
	].join("|");
}

function isResumeShape(value: unknown): value is CheckoutResumeState {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.cartId === "string" &&
		typeof record.orderId === "string" &&
		typeof record.publicReference === "string" &&
		(record.checkoutExpiresAt === null ||
			typeof record.checkoutExpiresAt === "string")
	);
}

/** Parses a stored JSON string into resume metadata, or null when malformed. */
export function parseResumeState(
	raw: string | null,
): CheckoutResumeState | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return isResumeShape(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Resume metadata is usable while its checkout window has not closed. A null
 * `checkoutExpiresAt` defers entirely to the server, which still rejects an
 * expired order on the payment-intent call. Whether the resumed order matches
 * the cart being checked out is the caller's concern (it compares cart ids and
 * item sets).
 */
export function isResumeUsable(
	state: CheckoutResumeState,
	nowMs: number,
): boolean {
	if (!state.checkoutExpiresAt) {
		return true;
	}
	const expiresMs = Date.parse(state.checkoutExpiresAt);
	return !Number.isNaN(expiresMs) && expiresMs > nowMs;
}

export function readResumeState(): CheckoutResumeState | null {
	if (typeof window === "undefined") {
		return null;
	}
	return parseResumeState(
		window.sessionStorage.getItem(CHECKOUT_RESUME_STORAGE_KEY),
	);
}

export function writeResumeState(state: CheckoutResumeState): void {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.setItem(
		CHECKOUT_RESUME_STORAGE_KEY,
		JSON.stringify(state),
	);
}

export function clearResumeState(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.removeItem(CHECKOUT_RESUME_STORAGE_KEY);
}
