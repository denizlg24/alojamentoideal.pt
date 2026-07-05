import type { ActivitySummary } from "@workspace/core/activities";
import { ActivityCard, ActivityCardSkeleton } from "./activity-card";

export function ActivitiesResults({
	activities,
}: {
	activities: ActivitySummary[];
}) {
	if (activities.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
				<p className="font-medium">No activities match your filters</p>
				<p className="text-muted-foreground text-sm">
					Try a different area or fewer filters.
				</p>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
			{activities.map((activity) => (
				<ActivityCard key={activity.id} activity={activity} />
			))}
		</div>
	);
}

export function ActivitiesResultsSkeleton({ count = 6 }: { count?: number }) {
	return (
		<div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
			{Array.from({ length: count }, (_, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
				<ActivityCardSkeleton key={index} />
			))}
		</div>
	);
}
