import { Skeleton } from "@workspace/ui/components/skeleton";

export default function OrderDetailLoading() {
	return (
		<div className="mx-auto max-w-4xl">
			<Skeleton className="h-4 w-16" />
			<div className="mt-3 flex items-start justify-between">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-8 w-40" />
			</div>
			<div className="mt-6 grid grid-cols-4 gap-6">
				{["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"].map((key) => (
					<Skeleton className="h-10 w-full" key={key} />
				))}
			</div>
			<Skeleton className="mt-10 h-40 w-full" />
			<Skeleton className="mt-10 h-24 w-full" />
		</div>
	);
}
