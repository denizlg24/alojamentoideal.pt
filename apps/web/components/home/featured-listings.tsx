import { Skeleton } from "@workspace/ui/components/skeleton";
import { getFeaturedListings } from "@/lib/catalog/featured";
import { ListingCard } from "./listing-card";

const FEATURED_COUNT = 6;

const SKELETON_KEYS = Array.from(
	{ length: FEATURED_COUNT },
	(_, index) => `featured-skeleton-${index}`,
);

export async function FeaturedListings() {
	const listings = await getFeaturedListings(FEATURED_COUNT);

	if (listings.length === 0) {
		return (
			<p className="text-center text-muted-foreground">
				No listings to show yet. Check back soon.
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{listings.map((listing) => (
				<ListingCard key={listing.id} listing={listing} />
			))}
		</div>
	);
}

export function FeaturedListingsSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{SKELETON_KEYS.map((key) => (
				<div key={key} className="flex flex-col gap-3">
					<Skeleton className="aspect-[16/9] w-full rounded-lg" />
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-5 w-1/2" />
							<Skeleton className="h-4 w-14" />
						</div>
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="mt-0.5 h-4 w-2/3" />
					</div>
				</div>
			))}
		</div>
	);
}
