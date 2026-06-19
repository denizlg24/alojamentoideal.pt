import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import { Badge } from "@workspace/ui/components/badge";
import { Bath, BedDouble, MapPin, Star, Users } from "lucide-react";
import Link from "next/link";

function formatLocation(listing: CatalogListingSummaryDto): string | null {
	const { city, country } = listing.location;
	return [city, country].filter(Boolean).join(", ") || null;
}

function pluralize(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

interface ListingReview {
	count: number;
	rating: number;
}

// TODO: replace with real review data once the reviews source is wired up.
// Derived from the listing id so each card stays stable across renders.
function placeholderReview(id: string): ListingReview {
	let hash = 0;
	for (let index = 0; index < id.length; index += 1) {
		hash = (hash * 31 + id.charCodeAt(index)) | 0;
	}
	const seed = Math.abs(hash);
	return {
		count: 8 + (seed % 240),
		rating: 4 + ((seed % 100) / 100) * 0.9,
	};
}

export function ListingCard({
	listing,
}: {
	listing: CatalogListingSummaryDto;
}) {
	const location = formatLocation(listing);
	const { guests, bedrooms, bathrooms } = listing.capacity;
	const distanceLabel =
		listing.distanceKm !== null ? `${listing.distanceKm} km away` : null;
	const review = placeholderReview(listing.id);

	return (
		<Link
			href={`/homes/${listing.id}`}
			className="group flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-lg">
				{listing.coverPhoto ? (
					// Plain img: the Hostify photo CDN host is not configured for
					// next/image, so this keeps the draft host-agnostic.
					<img
						src={listing.coverPhoto.thumbnailUrl ?? listing.coverPhoto.url}
						alt={listing.coverPhoto.caption ?? listing.title}
						loading="lazy"
						className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
						No photo
					</div>
				)}

				{listing.propertyType && (
					<Badge
						variant="secondary"
						className="absolute top-3 left-3 capitalize shadow-sm backdrop-blur-md"
					>
						{listing.propertyType}
					</Badge>
				)}
				{distanceLabel && (
					<Badge
						variant="secondary"
						className="absolute top-3 right-3 shadow-sm backdrop-blur-md"
					>
						{distanceLabel}
					</Badge>
				)}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="line-clamp-1 font-medium leading-tight">
						{listing.title}
					</h3>
					<span className="flex shrink-0 items-center gap-1 text-sm">
						<Star className="size-3.5 fill-current text-amber-500" />
						<span className="font-medium">{review.rating.toFixed(1)}</span>
						<span className="text-muted-foreground">({review.count})</span>
					</span>
				</div>

				{location && (
					<p className="flex items-center gap-1 text-muted-foreground text-sm">
						<MapPin className="size-3.5 shrink-0" />
						<span className="line-clamp-1">{location}</span>
					</p>
				)}

				<div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-foreground/80 text-sm">
					{guests !== null && (
						<span className="flex items-center gap-1.5">
							<Users className="size-4 text-muted-foreground" />
							{pluralize(guests, "guest")}
						</span>
					)}
					{bedrooms !== null && (
						<span className="flex items-center gap-1.5">
							<BedDouble className="size-4 text-muted-foreground" />
							{pluralize(bedrooms, "bed")}
						</span>
					)}
					{bathrooms !== null && (
						<span className="flex items-center gap-1.5">
							<Bath className="size-4 text-muted-foreground" />
							{pluralize(bathrooms, "bath")}
						</span>
					)}
				</div>
			</div>
		</Link>
	);
}
