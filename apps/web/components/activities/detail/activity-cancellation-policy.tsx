import type { ActivityDetail } from "@workspace/core/activities";
import { describeBokunCancellationPolicy } from "@workspace/core/commerce";
import { CalendarX } from "lucide-react";

/**
 * Guest-facing cancellation terms for one activity, derived from the Bokun
 * cancellation policy captured by the daily sync. Falls back to a generic
 * contact line when the policy is missing or cannot be interpreted, so we
 * never show wrong terms.
 */
export function ActivityCancellationPolicy({
	activity,
}: {
	activity: ActivityDetail;
}) {
	const lines = describeBokunCancellationPolicy(activity.cancellationPolicy);

	return (
		<section className="flex flex-col gap-3">
			<h2 className="flex items-center gap-2 font-heading font-semibold text-xl">
				<CalendarX className="size-5" />
				Cancellation policy
			</h2>
			{lines.length > 0 ? (
				<ul className="flex flex-col gap-1.5 text-muted-foreground text-sm">
					{lines.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
			) : (
				<p className="text-muted-foreground text-sm">
					Cancellation terms vary for this activity. Contact us before booking
					if you need flexibility.
				</p>
			)}
		</section>
	);
}
