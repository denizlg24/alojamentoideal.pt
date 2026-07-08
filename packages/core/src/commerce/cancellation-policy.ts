const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Stay cancellation policy, ported verbatim from the legacy app
 * (components/orders/property-info-card.tsx getRefundPercentage). Hard rules
 * keyed on the check-in date plus a 48h post-booking grace window:
 * - 100%: booked at most 48h ago AND at least 14 days before check-in
 * - 50%: at least 14 days before check-in (grace expired), or 7-13 days before
 * - 0%: under 7 days before check-in
 */
export function stayRefundPercent(input: {
	at: Date;
	bookedAt: Date;
	checkIn: Date;
}): 0 | 50 | 100 {
	const hoursSinceBooking = Math.trunc(
		(input.at.getTime() - input.bookedAt.getTime()) / HOUR_MS,
	);
	const daysBeforeCheckIn = Math.trunc(
		(input.checkIn.getTime() - input.at.getTime()) / DAY_MS,
	);

	if (hoursSinceBooking <= 48 && daysBeforeCheckIn >= 14) {
		return 100;
	}
	if (
		(daysBeforeCheckIn >= 14 && hoursSinceBooking > 48) ||
		(daysBeforeCheckIn >= 7 && daysBeforeCheckIn < 14)
	) {
		return 50;
	}
	return 0;
}

export interface BokunPenaltyRule {
	/** Penalty applies when cancelling within this many hours of the start. */
	cutoffHours: number;
	/** Percentage of the booking value charged as a cancellation penalty. */
	percentage: number;
}

/**
 * The slice of a Bokun activity `cancellationPolicy` the refund math needs.
 * Produced by {@link parseBokunCancellationPolicy} from the raw activity
 * detail; never constructed from unvalidated provider data directly.
 */
export interface BokunCancellationPolicySnapshot {
	penaltyRules: BokunPenaltyRule[];
	policyType: string | null;
	simpleCutoffHours: number | null;
	title: string | null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates the `cancellationPolicy` object from a Bokun activity detail
 * (v1 `/activity.json/{id}`). Returns null when the payload is missing or not
 * object-shaped; malformed penalty rules are dropped individually so a single
 * bad rule cannot poison the policy.
 */
export function parseBokunCancellationPolicy(
	raw: unknown,
): BokunCancellationPolicySnapshot | null {
	if (typeof raw !== "object" || raw === null) {
		return null;
	}
	const policy = raw as Record<string, unknown>;
	const rawRules = Array.isArray(policy.penaltyRules)
		? policy.penaltyRules
		: [];
	const penaltyRules: BokunPenaltyRule[] = [];
	for (const rawRule of rawRules) {
		if (typeof rawRule !== "object" || rawRule === null) {
			continue;
		}
		const rule = rawRule as Record<string, unknown>;
		if (
			isFiniteNumber(rule.cutoffHours) &&
			rule.cutoffHours >= 0 &&
			isFiniteNumber(rule.percentage) &&
			rule.percentage >= 0
		) {
			penaltyRules.push({
				cutoffHours: rule.cutoffHours,
				percentage: rule.percentage,
			});
		}
	}
	return {
		penaltyRules,
		policyType:
			typeof policy.policyType === "string" ? policy.policyType : null,
		simpleCutoffHours: isFiniteNumber(policy.simpleCutoffHours)
			? policy.simpleCutoffHours
			: null,
		title: typeof policy.title === "string" ? policy.title : null,
	};
}

/**
 * Refundable percentage for an activity booking under its Bokun cancellation
 * policy, evaluated at `at` against the activity start. Returns null when the
 * policy cannot be interpreted, so callers surface "manual review" instead of
 * guessing. Percentages are Bokun penalty percentages, so the refund is the
 * complement of the strictest penalty window containing `at`.
 */
export function activityRefundPercent(
	policy: BokunCancellationPolicySnapshot | null,
	input: { at: Date; startAt: Date },
): number | null {
	if (!policy) {
		return null;
	}
	const hoursUntilStart =
		(input.startAt.getTime() - input.at.getTime()) / HOUR_MS;
	if (hoursUntilStart <= 0) {
		return 0;
	}
	if (policy.policyType === "NON_REFUNDABLE") {
		return 0;
	}
	if (policy.policyType === "FULL_REFUND") {
		return 100;
	}
	if (policy.simpleCutoffHours !== null) {
		return hoursUntilStart >= policy.simpleCutoffHours ? 100 : 0;
	}
	if (policy.penaltyRules.length > 0) {
		const applicable = policy.penaltyRules.filter(
			(rule) => hoursUntilStart < rule.cutoffHours,
		);
		if (applicable.length === 0) {
			return 100;
		}
		const penalty = Math.max(...applicable.map((rule) => rule.percentage));
		return Math.min(100, Math.max(0, 100 - penalty));
	}
	return null;
}

/**
 * Minor-unit refund suggestion for a policy percentage: exact value at 100%
 * (no rounding drift), otherwise rounded to the nearest cent.
 */
export function policyRefundAmountMinor(
	totalMinor: number,
	percent: number,
): number {
	if (totalMinor <= 0 || percent <= 0) {
		return 0;
	}
	if (percent >= 100) {
		return totalMinor;
	}
	return Math.min(totalMinor, Math.round((totalMinor * percent) / 100));
}
