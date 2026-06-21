import { Skeleton } from "@workspace/ui/components/skeleton";
import { ListingCardSkeleton } from "@/components/listings/listing-card";

const SKELETON_KEYS = ["a", "b", "c", "d"];

export function HomesSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4">
				<Skeleton className="h-10 w-2/3 rounded-full" />
				<Skeleton className="h-16 rounded-full" />
			</div>

			<Skeleton className="h-72 rounded-2xl lg:hidden" />

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(340px,400px)]">
				<div className="flex flex-col gap-4">
					{SKELETON_KEYS.map((key) => (
						<ListingCardSkeleton key={key} layout="row" />
					))}
				</div>
				<aside className="hidden lg:block">
					<Skeleton className="sticky top-24 h-[calc(100vh-7rem)] rounded-2xl" />
				</aside>
			</div>
		</div>
	);
}
