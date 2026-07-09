/**
 * One-shot handoff of a checkout failure to the cart page. When the purchase
 * flow fails fast (for example a reservation hold is rejected because one stay
 * is no longer available), checkout rebuilds a mutable cart and sends the
 * guest back to `/cart`. This sessionStorage note is how the cart page learns
 * what happened, so it can explain the failure instead of rendering silently.
 * Only guest-facing copy and stay titles are stored here; never tokens or PII.
 */

export interface CartRecoveryNotice {
	/** Guest-friendly reason the purchase stopped (already normalized copy). */
	message: string;
	/** Titles of items dropped during the cart rebuild because they no longer quote. */
	removedTitles: string[];
}

export const CART_NOTICE_STORAGE_KEY = "ai_cart_notice";

function hasWindow(): boolean {
	return typeof window !== "undefined";
}

/** Parses a stored JSON string into a recovery notice, or null when malformed. */
export function parseCartNotice(raw: string | null): CartRecoveryNotice | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		if (typeof record.message !== "string" || record.message.length === 0) {
			return null;
		}
		if (!Array.isArray(record.removedTitles)) {
			return null;
		}
		return {
			message: record.message,
			removedTitles: record.removedTitles.filter(
				(title): title is string => typeof title === "string",
			),
		};
	} catch {
		return null;
	}
}

/**
 * Full alert body for a recovery notice: the failure reason plus, when items
 * were dropped in the rebuild, which ones were taken out of the cart.
 */
export function cartNoticeBody(notice: CartRecoveryNotice): string {
	if (notice.removedTitles.length === 0) {
		return `${notice.message} Please review your cart and try again.`;
	}
	const names = notice.removedTitles.map((title) => `"${title}"`);
	const list =
		names.length === 1
			? names[0]
			: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
	const subject = names.length === 1 ? "it is" : "they are";
	return `${notice.message} We removed ${list} from your cart because ${subject} no longer available for the selected details.`;
}

export function writeCartNotice(notice: CartRecoveryNotice): void {
	if (!hasWindow()) {
		return;
	}
	window.sessionStorage.setItem(
		CART_NOTICE_STORAGE_KEY,
		JSON.stringify(notice),
	);
}

/** Reads and clears the pending notice, so it shows exactly once. */
export function takeCartNotice(): CartRecoveryNotice | null {
	if (!hasWindow()) {
		return null;
	}
	const notice = parseCartNotice(
		window.sessionStorage.getItem(CART_NOTICE_STORAGE_KEY),
	);
	window.sessionStorage.removeItem(CART_NOTICE_STORAGE_KEY);
	return notice;
}
