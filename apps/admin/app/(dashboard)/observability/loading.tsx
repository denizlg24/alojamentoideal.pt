import { Skeleton } from "@workspace/ui/components/skeleton";

export default function ObservabilityLoading() {
	return (
		<div className="mx-auto max-w-5xl">
			<Skeleton className="h-7 w-40" />
			<Skeleton className="mt-2 h-4 w-96" />
			<div className="mt-8 space-y-2.5">
				{["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"].map(
					(key) => (
						<Skeleton className="h-8 w-full" key={key} />
					),
				)}
			</div>
		</div>
	);
}
