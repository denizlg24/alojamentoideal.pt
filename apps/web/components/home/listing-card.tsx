import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import { Badge } from "@workspace/ui/components/badge";
import { BedDouble, MapPin, Star, Toilet, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

function formatLocation(listing: CatalogListingSummaryDto): string | null {
	const { city, country } = listing.location;
	return [city, country].filter(Boolean).join(", ") || null;
}

function pluralize(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function ListingCard({
	listing,
}: {
	listing: CatalogListingSummaryDto;
}) {
	const location = formatLocation(listing);
	const { guests, beds, bathrooms } = listing.capacity;
	const distanceLabel =
		listing.distanceKm !== null ? `${listing.distanceKm} km away` : null;
	const { average: rating, count: reviewCount } = listing.reviews;

	return (
		<Link
			href={`/homes/${listing.id}`}
			className="group flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-lg">
				{listing.coverPhoto ? (
					<Image
						src={listing.coverPhoto.thumbnailUrl ?? listing.coverPhoto.url}
						alt={listing.coverPhoto.caption ?? listing.title}
						fill
						sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
						className="object-cover transition-transform duration-500 group-hover:scale-105"
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
					{rating !== null && (
						<span className="flex shrink-0 items-center gap-1 text-sm">
							<Star className="size-3.5 fill-current text-amber-500" />
							<span className="font-medium">{rating.toFixed(1)}</span>
							<span className="text-muted-foreground">({reviewCount})</span>
						</span>
					)}
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
					{beds !== null && (
						<span className="flex items-center gap-1.5">
							<BedDouble className="size-4 text-muted-foreground" />
							{pluralize(beds, "bed")}
						</span>
					)}
					{bathrooms !== null && (
						<span className="flex items-center gap-1.5">
							<Toilet className="size-4 text-muted-foreground" />
							{pluralize(bathrooms, "bathroom")}
						</span>
					)}
				</div>
			</div>
		</Link>
	);
}
