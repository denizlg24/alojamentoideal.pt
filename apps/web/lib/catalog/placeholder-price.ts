/**
 * Deterministic placeholder nightly price, used until real pricing is wired up.
 * Derived from the listing id so a given listing always shows the same figure
 * across renders and pages. NOT a real rate; do not use it for filtering or any
 * money math.
 */
const MIN_PRICE = 70;
const MAX_PRICE = 220;
const STEP = 5;

export function placeholderNightlyPrice(listingId: string): number {
	let hash = 0;
	for (let index = 0; index < listingId.length; index += 1) {
		hash = (hash * 31 + listingId.charCodeAt(index)) >>> 0;
	}

	const steps = Math.floor((MAX_PRICE - MIN_PRICE) / STEP);
	return MIN_PRICE + (hash % (steps + 1)) * STEP;
}

export function formatPlaceholderPrice(listingId: string): string {
	return `€${placeholderNightlyPrice(listingId)}`;
}
