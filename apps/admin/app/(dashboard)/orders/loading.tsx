import { Skeleton } from "@workspace/ui/components/skeleton";

export default function OrdersLoading() {
	return (
		<div className="mx-auto max-w-5xl">
			<Skeleton className="h-7 w-28" />
			<Skeleton className="mt-2 h-4 w-96" />
			<div className="mt-8 space-y-3">
				{["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].map((key) => (
					<Skeleton className="h-9 w-full" key={key} />
				))}
			</div>
		</div>
	);
}
