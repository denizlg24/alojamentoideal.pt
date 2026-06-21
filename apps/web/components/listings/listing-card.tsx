import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	BedDouble,
	Bookmark,
	CalendarDays,
	Home,
	type LucideIcon,
	MapPin,
	Star,
	Toilet,
	Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import type { ListingCardPrice } from "@/lib/catalog/pricing-display";
import {
	ListingCardPriceAsync,
	ListingCardPriceSkeleton,
	ListingCardPriceValue,
} from "./listing-card-price";

export type ListingCardLayout = "compact" | "row";

function formatLocation(listing: CatalogListingSummaryDto): string | null {
	const { city, country } = listing.location;
	const normalizedCountry = country?.trim().toLowerCase();
	const visibleCountry =
		normalizedCountry === "portugal" || normalizedCountry === "pt"
			? null
			: country;
	return [city, visibleCountry].filter(Boolean).join(", ") || null;
}

function pluralize(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

interface CapacityStat {
	icon: LucideIcon;
	label: string;
}

function capacityStats(listing: CatalogListingSummaryDto): CapacityStat[] {
	const { guests, beds, bathrooms } = listing.capacity;
	const stats: CapacityStat[] = [];
	if (guests !== null)
		stats.push({ icon: Users, label: pluralize(guests, "guest") });
	if (beds !== null)
		stats.push({ icon: BedDouble, label: pluralize(beds, "bed") });
	if (bathrooms !== null)
		stats.push({ icon: Toilet, label: pluralize(bathrooms, "bathroom") });
	return stats;
}

function ratingLabel(average: number): string {
	if (average >= 4.8) return "Exceptional";
	if (average >= 4.5) return "Excellent";
	if (average >= 4) return "Very good";
	if (average >= 3.5) return "Good";
	return "Pleasant";
}

function formatPropertyType(listing: CatalogListingSummaryDto): string | null {
	const value = listing.propertyType?.trim();
	if (!value) return null;

	return value
		.replaceAll("_", " ")
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function amenityLabel(count: number): string | null {
	if (count <= 0) return null;
	return `${count} ${count === 1 ? "amenity" : "amenities"}`;
}

function CapacityRow({ stats }: { stats: CapacityStat[] }) {
	if (stats.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
			{stats.map((stat) => (
				<span key={stat.label} className="flex items-center gap-1.5">
					<stat.icon className="size-4" />
					{stat.label}
				</span>
			))}
		</div>
	);
}

export function ListingCard({
	layout = "compact",
	listing,
	price,
	pricePromise,
	stayQuery,
}: {
	layout?: ListingCardLayout;
	listing: CatalogListingSummaryDto;
	price?: ListingCardPrice;
	/**
	 * Streamed price, resolved inside a `<Suspense>` so the card body renders
	 * before the (slower) pricing read completes. Takes precedence over `price`.
	 */
	pricePromise?: Promise<ListingCardPrice | undefined>;
	stayQuery?: string;
}) {
	const href = `/homes/${listing.id}${stayQuery ?? ""}`;
	const location = formatLocation(listing);
	const stats = capacityStats(listing);
	const { average: rating, count: reviewCount } = listing.reviews;
	const distanceLabel =
		listing.distanceKm !== null ? `${listing.distanceKm} km away` : null;
	const propertyTypeLabel = formatPropertyType(listing);
	const visibleAmenityLabel = amenityLabel(listing.amenityCount);
	const priceNode = pricePromise ? (
		<Suspense fallback={<ListingCardPriceSkeleton layout={layout} />}>
			<ListingCardPriceAsync
				layout={layout}
				listingId={listing.id}
				pricePromise={pricePromise}
			/>
		</Suspense>
	) : (
		<ListingCardPriceValue
			layout={layout}
			listingId={listing.id}
			value={price}
		/>
	);
	const hasStay = Boolean(stayQuery);

	if (layout === "row") {
		return (
			<article className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md md:min-h-44 md:flex-row">
				<Link
					href={href}
					className="relative aspect-16/10 shrink-0 overflow-hidden bg-muted md:aspect-auto md:w-56 lg:w-64"
					aria-label={listing.title}
				>
					{listing.coverPhoto ? (
						<Image
							src={listing.coverPhoto.thumbnailUrl ?? listing.coverPhoto.url}
							alt={listing.coverPhoto.caption ?? listing.title}
							fill
							sizes="(max-width: 768px) 100vw, 16rem"
							className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
						/>
					) : (
						<div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
							No photo
						</div>
					)}
					{distanceLabel && (
						<Badge
							variant="secondary"
							className="absolute bottom-3 left-3 bg-emerald-600 text-white shadow-sm backdrop-blur-md"
						>
							{distanceLabel}
						</Badge>
					)}
				</Link>

				<div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:flex-row md:items-stretch">
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Link
							href={href}
							className="line-clamp-1 font-semibold text-base leading-tight hover:underline"
						>
							{listing.title}
						</Link>

						<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
							{rating !== null && (
								<>
									<span className="flex items-center gap-1 font-semibold">
										<Star className="size-3.5 fill-amber-500 text-amber-500" />
										{rating.toFixed(1)}
									</span>
									<span className="text-muted-foreground">({reviewCount})</span>
									<span className="text-muted-foreground">•</span>
									<span className="font-medium">{ratingLabel(rating)}</span>
								</>
							)}
							{location && (
								<>
									<span className="hidden text-muted-foreground sm:inline">
										•
									</span>
									<span className="flex min-w-0 items-center gap-1 text-muted-foreground">
										<MapPin className="size-3.5 shrink-0" />
										<span className="line-clamp-1">{location}</span>
									</span>
								</>
							)}
						</div>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border/70 border-t pt-3 text-muted-foreground text-sm md:border-t-0 md:pt-1">
							{propertyTypeLabel && (
								<span className="flex items-center gap-1.5">
									<Home className="size-4" />
									{propertyTypeLabel}
								</span>
							)}
							{visibleAmenityLabel && (
								<span className="flex items-center gap-1.5">
									<Bookmark className="size-4" />
									{visibleAmenityLabel}
								</span>
							)}
						</div>

						<CapacityRow stats={stats} />
					</div>

					<div className="flex items-center justify-between gap-3 border-border/70 border-t pt-3 md:w-40 md:flex-col md:items-end md:border-t-0 md:pt-0">
						{priceNode}

						<div className="flex items-center gap-2">
							<Button asChild size="sm" className="rounded-full">
								<Link href={href}>
									{hasStay ? "Book now" : "View dates"}
									<CalendarDays className="size-3.5" />
								</Link>
							</Button>
							<span
								className="flex size-8 items-center justify-center rounded-full border bg-background"
								aria-hidden="true"
							>
								<Bookmark className="size-4" />
							</span>
						</div>
					</div>
				</div>
			</article>
		);
	}

	return (
		<Link
			href={href}
			className="group flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<div className="relative aspect-video overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-lg">
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

				<CapacityRow stats={stats} />

				{priceNode}
			</div>
		</Link>
	);
}

export function ListingCardSkeleton({
	layout = "compact",
}: {
	layout?: ListingCardLayout;
}) {
	if (layout === "row") {
		return (
			<div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm md:min-h-44 md:flex-row">
				<Skeleton className="aspect-16/10 shrink-0 rounded-none md:aspect-auto md:w-56 lg:w-64" />
				<div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
					<div className="flex flex-1 flex-col gap-2">
						<Skeleton className="h-5 w-2/3" />
						<Skeleton className="h-4 w-4/5" />
						<div className="flex gap-3 pt-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-4 w-28" />
						</div>
						<Skeleton className="h-4 w-2/3" />
					</div>
					<div className="flex items-end justify-between border-border/70 border-t pt-3 md:w-40 md:flex-col md:border-t-0 md:pt-0">
						<div className="flex flex-col items-end gap-1">
							<Skeleton className="h-6 w-16" />
							<Skeleton className="h-3 w-12" />
						</div>
						<div className="flex items-center gap-2">
							<Skeleton className="h-8 w-24 rounded-full" />
							<Skeleton className="size-8 rounded-full" />
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="aspect-video w-full rounded-lg" />
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-5 w-1/2" />
					<Skeleton className="h-4 w-14" />
				</div>
				<Skeleton className="h-4 w-1/3" />
				<Skeleton className="mt-0.5 h-4 w-2/3" />
			</div>
		</div>
	);
}
