import {
	activityRefundPercent,
	type OrderDetail,
	type OrderDetailItem,
	parseBokunCancellationPolicy,
	policyRefundAmountMinor,
	stayRefundPercent,
} from "@workspace/core/commerce";
import {
	BokunConfigurationError,
	createBokunClientFromEnv,
} from "@workspace/core/integrations/bokun";
import { logger } from "@workspace/core/observability";

/**
 * Operator-facing cancellation policy suggestion for one order item. `percent`
 * is null when the policy could not be evaluated (Bokun unreachable, policy
 * shape unknown), in which case the label says so and the operator decides.
 */
export interface RefundPolicySuggestion {
	itemId: string;
	label: string;
	percent: number | null;
	suggestedAmountMinor: number | null;
}

const DAY_MS = 86_400_000;

function staySuggestion(
	detail: OrderDetail,
	item: OrderDetailItem,
	now: Date,
): RefundPolicySuggestion | null {
	if (!item.checkIn) {
		return null;
	}
	const checkIn = new Date(item.checkIn);
	if (Number.isNaN(checkIn.getTime())) {
		return null;
	}
	const percent = stayRefundPercent({
		at: now,
		bookedAt: new Date(detail.createdAt),
		checkIn,
	});
	const daysBefore = Math.trunc((checkIn.getTime() - now.getTime()) / DAY_MS);
	return {
		itemId: item.id,
		label:
			daysBefore >= 0
				? `Stay policy: ${percent}% refundable (${daysBefore} day${daysBefore === 1 ? "" : "s"} before check-in)`
				: `Stay policy: ${percent}% refundable (check-in passed)`,
		percent,
		suggestedAmountMinor:
			item.pricing === null
				? null
				: policyRefundAmountMinor(item.pricing.totalMinor, percent),
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Resolves the activity's local start instant from the persisted date and the
 * Bokun start-time id. Falls back to midnight when the start time cannot be
 * matched, which errs toward a lower refund suggestion near the cutoffs.
 */
function activityStartAt(
	activityDate: string,
	startTimeId: string | null,
	rawDetail: Record<string, unknown>,
): Date {
	let hour = 0;
	let minute = 0;
	if (startTimeId && Array.isArray(rawDetail.startTimes)) {
		for (const rawStartTime of rawDetail.startTimes) {
			if (typeof rawStartTime !== "object" || rawStartTime === null) {
				continue;
			}
			const startTime = rawStartTime as Record<string, unknown>;
			if (
				String(startTime.id) === startTimeId &&
				isFiniteNumber(startTime.hour) &&
				isFiniteNumber(startTime.minute)
			) {
				hour = startTime.hour;
				minute = startTime.minute;
				break;
			}
		}
	}
	const hh = String(hour).padStart(2, "0");
	const mm = String(minute).padStart(2, "0");
	// Server-local time; activities and the admin operate in the same zone.
	return new Date(`${activityDate}T${hh}:${mm}:00`);
}

async function activitySuggestion(
	item: OrderDetailItem,
	now: Date,
): Promise<RefundPolicySuggestion | null> {
	if (!item.activity || !item.activityDate) {
		return null;
	}

	let rawDetail: Record<string, unknown>;
	try {
		const client = createBokunClientFromEnv();
		rawDetail = (await client.v1.activity.get(
			item.activity.bokunActivityId,
		)) as Record<string, unknown>;
	} catch (error) {
		if (!(error instanceof BokunConfigurationError)) {
			logger.warn("Failed to load Bokun cancellation policy", {
				activityId: item.activity.bokunActivityId,
				error: error instanceof Error ? error.message : String(error),
				itemId: item.id,
			});
		}
		return {
			itemId: item.id,
			label: "Bokun policy unavailable; review manually",
			percent: null,
			suggestedAmountMinor: null,
		};
	}

	const policy = parseBokunCancellationPolicy(rawDetail.cancellationPolicy);
	const percent = activityRefundPercent(policy, {
		at: now,
		startAt: activityStartAt(
			item.activityDate,
			item.activity.startTimeId,
			rawDetail,
		),
	});
	if (percent === null) {
		return {
			itemId: item.id,
			label: policy?.title
				? `Bokun policy "${policy.title}" needs manual review`
				: "Bokun policy needs manual review",
			percent: null,
			suggestedAmountMinor: null,
		};
	}
	return {
		itemId: item.id,
		label: `Bokun policy${policy?.title ? ` "${policy.title}"` : ""}: ${percent}% refundable`,
		percent,
		suggestedAmountMinor:
			item.pricing === null
				? null
				: policyRefundAmountMinor(item.pricing.totalMinor, percent),
	};
}

/**
 * Per-item cancellation policy suggestions for the admin refund dialog: stays
 * use the legacy hard rules against check-in, activities evaluate the live
 * Bokun cancellation policy. Purely advisory — the operator can always enter
 * a different amount.
 */
export async function buildRefundPolicySuggestions(
	detail: OrderDetail,
	now: Date = new Date(),
): Promise<RefundPolicySuggestion[]> {
	const suggestions = await Promise.all(
		detail.items.map((item) => {
			if (item.type === "accommodation") {
				return Promise.resolve(staySuggestion(detail, item, now));
			}
			if (item.type === "activity") {
				return activitySuggestion(item, now);
			}
			return Promise.resolve(null);
		}),
	);
	return suggestions.filter(
		(suggestion): suggestion is RefundPolicySuggestion => suggestion !== null,
	);
}
