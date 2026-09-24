import { Skeleton } from "@workspace/ui/components/skeleton";

export default function PromotionsLoading() {
	return (
		<div className="mx-auto max-w-6xl">
			<Skeleton className="h-7 w-36" />
			<Skeleton className="mt-2 h-4 w-full max-w-xl" />
			<Skeleton className="mt-6 h-8 w-56" />
			<div className="mt-4 space-y-3">
				{["r1", "r2", "r3", "r4", "r5", "r6"].map((key) => (
					<Skeleton className="h-12 w-full" key={key} />
				))}
			</div>
		</div>
	);
}
