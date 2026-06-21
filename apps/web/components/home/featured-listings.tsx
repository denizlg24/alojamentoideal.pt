import { getListingCacheConfig } from "@workspace/core/listing-cache";
import {
	ListingCard,
	ListingCardSkeleton,
} from "@/components/listings/listing-card";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";
import { getFeaturedListings } from "@/lib/catalog/featured";
import { getCachedAdvisoryPrices } from "@/lib/catalog/pricing";
import { advisoryPriceMap } from "@/lib/catalog/pricing-display";

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

	const config = getListingCacheConfig();
	const advisory = await getCachedAdvisoryPrices(
		{ accountId: config.hostifyAccountId, provider: HOSTIFY_PROVIDER },
		listings.map((listing) => listing.id),
	);
	const prices = advisoryPriceMap(advisory);

	return (
		<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{listings.map((listing) => (
				<ListingCard
					key={listing.id}
					layout="compact"
					listing={listing}
					price={prices.get(listing.id)}
				/>
			))}
		</div>
	);
}

export function FeaturedListingsSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{SKELETON_KEYS.map((key) => (
				<ListingCardSkeleton key={key} layout="compact" />
			))}
		</div>
	);
}
