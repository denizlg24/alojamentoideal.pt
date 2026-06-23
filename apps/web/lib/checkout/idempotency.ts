/**
 * Idempotency-key helpers for checkout mutations. The cart API requires keys
 * matching `^[A-Za-z0-9._:-]+$`, 8-160 chars. Bootstrap keys are deterministic
 * so reloading the booking route does not spawn duplicate cart items; one-off
 * action keys are random so each user-initiated mutation is distinct.
 */

const UNSAFE = /[^A-Za-z0-9._:-]/g;
const MIN_LENGTH = 8;
const MAX_LENGTH = 160;

function sanitize(part: string | number): string {
	return String(part).replace(UNSAFE, "-");
}

function clamp(key: string): string {
	const trimmed = key.slice(0, MAX_LENGTH);
	return trimmed.length >= MIN_LENGTH
		? trimmed
		: trimmed.padEnd(MIN_LENGTH, "0");
}

export interface StayKeyInput {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	guests: number;
	infants: number;
	listingId: string;
}

/**
 * Deterministic key for the listing->cart bootstrap item. Stable across reloads
 * of the same booking route + stay so the server dedupes instead of adding a
 * second item.
 */
export function cartItemIdempotencyKey(input: StayKeyInput): string {
	return clamp(
		[
			"item",
			sanitize(input.listingId),
			input.checkIn,
			input.checkOut,
			`g${input.guests}`,
			`a${input.adults}`,
			`c${input.children}`,
			`i${input.infants}`,
		].join(":"),
	);
}

/** Deterministic client mutation id paired with the bootstrap item key. */
export function cartItemClientMutationId(input: StayKeyInput): string {
	return cartItemIdempotencyKey(input).slice(0, 128);
}

/** Random key for a discrete, user-initiated mutation (discount, date edit). */
export function randomIdempotencyKey(prefix: string): string {
	return clamp(`${sanitize(prefix)}.${crypto.randomUUID()}`);
}
