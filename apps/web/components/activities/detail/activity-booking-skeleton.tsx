import { Skeleton } from "@workspace/ui/components/skeleton";

export function ActivityBookingSkeleton() {
	return (
		<div className="hidden lg:block">
			<div className="sticky top-24 flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-lg">
				<Skeleton className="h-7 w-32" />
				<Skeleton className="h-24 w-full rounded-xl" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full rounded-xl" />
					<Skeleton className="h-auto aspect-square w-full rounded-xl" />
				</div>
				<Skeleton className="h-11 w-full rounded-md" />
			</div>
		</div>
	);
}
