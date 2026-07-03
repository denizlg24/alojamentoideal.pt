const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const GUEST_INFO_REMINDER_MIN_DELAY_MS = 4 * HOUR_MS;
export const GUEST_INFO_REMINDER_MAX_DELAY_MS = 14 * DAY_MS;

export interface GuestInfoReminderFacts {
	accommodationTitle: string;
	checkIn: string;
	checkOut: string;
	email: string;
	missingGuestCount: number;
	orderId: string;
	publicReference: string;
	totalGuestCount: number;
}

/**
 * Reverse exponential reminder cadence: after each reminder, wait for half of
 * the remaining time until check-in, clamped to keep far-away stays quiet and
 * near-arrival reminders useful without becoming noisy.
 */
export function nextGuestInfoReminderDelayMs(
	now: Date,
	stayStartsAt: Date,
): number | null {
	const remainingMs = stayStartsAt.getTime() - now.getTime();
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
		return null;
	}

	const delayMs = Math.min(
		GUEST_INFO_REMINDER_MAX_DELAY_MS,
		Math.max(GUEST_INFO_REMINDER_MIN_DELAY_MS, Math.floor(remainingMs / 2)),
	);

	return delayMs < remainingMs ? delayMs : null;
}

export function nextGuestInfoReminderAt(
	now: Date,
	stayStartsAt: Date,
): Date | null {
	const delayMs = nextGuestInfoReminderDelayMs(now, stayStartsAt);
	return delayMs === null ? null : new Date(now.getTime() + delayMs);
}
