import { getAccommodationsConfig } from "@workspace/core/accommodations";
import type {
	CatalogListingDetailDto,
	CatalogRoomDto,
} from "@workspace/core/catalog";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Bath, Bed, Dog, DoorOpen, Star, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { BookingWidget } from "@/components/listings/detail/booking-widget";
import { ListingAmenities } from "@/components/listings/detail/listing-amenities";
import { ListingCancellationPolicy } from "@/components/listings/detail/listing-cancellation-policy";
import { ListingGallery } from "@/components/listings/detail/listing-gallery";
import { ListingLocation } from "@/components/listings/detail/listing-location";
import { ListingReviews } from "@/components/listings/detail/listing-reviews";
import { ShareButton } from "@/components/listings/detail/share-dialog";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import {
	generateListingStaticParams,
	getListingCatalogScope,
} from "@/lib/catalog/listing-route";
import { getCachedListingReviews } from "@/lib/catalog/reviews";
import {
	buildPageMetadata,
	truncateMetaDescription,
} from "@/lib/site/metadata";

interface ListingPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateStaticParams(): Promise<{ id: string }[]> {
	return generateListingStaticParams();
}

export async function generateMetadata({
	params,
}: ListingPageProps): Promise<Metadata> {
	const { id } = await params;
	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	if (!listing) {
		return {
			title: "Listing not found",
			robots: { follow: true, index: false },
		};
	}

	const description = truncateMetaDescription(
		listing.description,
		"Explore this Alojamento Ideal apartment with modern comforts, local character and direct guest support.",
	);
	return buildPageMetadata({
		title: listing.title,
		description,
		path: `/homes/${id}`,
		image: listing.coverPhoto?.url,
		keywords: [
			listing.title,
			listing.location.city,
			listing.location.country,
			"Alojamento Ideal home",
		].filter((keyword): keyword is string => Boolean(keyword)),
	});
}

function capacityParts(listing: CatalogListingDetailDto): string[] {
	const parts: string[] = [];
	const { capacity } = listing;
	if (listing.propertyType) parts.push(listing.propertyType);
	if (capacity.guests) parts.push(`${capacity.guests} guests`);
	if (capacity.bedrooms)
		parts.push(
			`${capacity.bedrooms} ${capacity.bedrooms === 1 ? "bedroom" : "bedrooms"}`,
		);
	if (capacity.beds)
		parts.push(`${capacity.beds} ${capacity.beds === 1 ? "bed" : "beds"}`);
	if (capacity.bathrooms)
		parts.push(
			`${capacity.bathrooms} ${capacity.bathrooms === 1 ? "bath" : "baths"}`,
		);
	if (listing.petFriendly) parts.push("Pet-friendly");
	return parts;
}

function titleCase(value: string): string {
	return value
		.toLowerCase()
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

function roomName(room: CatalogRoomDto, index: number): string {
	const name = room.name?.trim();
	return name ? titleCase(name) : `Bedroom ${index + 1}`;
}

function roomBeds(room: CatalogRoomDto): string {
	const beds = room.beds
		.filter((bed) => bed.type)
		.map((bed) => `${bed.count ?? 1} ${bed.type}`);
	return beds.length > 0 ? beds.join(", ") : "—";
}

async function ListingContent({
	params,
}: {
	params: ListingPageProps["params"];
}) {
	const { id } = await params;

	if (id === "__ci_placeholder__") {
		notFound();
	}

	const scope = getListingCatalogScope();

	const listing = await getCachedCatalogDetail(id, scope, "en");
	if (!listing) {
		notFound();
	}

	const reviewData = await getCachedListingReviews(id, scope);

	const locationLabel =
		[listing.location.city, listing.location.country]
			.filter(Boolean)
			.join(", ") || null;
	const config = getAccommodationsConfig();
	const sleepingRooms = listing.rooms.filter(
		(room) =>
			room.beds.length > 0 && !room.name?.toLowerCase().includes("bath"),
	);

	return (
		<div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
			<div className="mb-4 flex flex-col gap-1">
				<h1 className="font-heading font-semibold text-2xl sm:text-3xl">
					{listing.title}
				</h1>
				<div className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm">
					{listing.reviews.average !== null && (
						<span className="flex items-center gap-1 text-foreground">
							<Star className="size-4 fill-foreground" />
							{listing.reviews.average.toFixed(2)}
							<span className="text-muted-foreground">
								· {listing.reviews.count}{" "}
								{listing.reviews.count === 1 ? "review" : "reviews"}
							</span>
						</span>
					)}
					{locationLabel && (
						<>
							{listing.reviews.average !== null && <span>·</span>}
							<span className="underline">{locationLabel}</span>
						</>
					)}
					<ShareButton
						title={listing.title}
						subtitle={locationLabel}
						imageUrl={listing.coverPhoto?.url ?? null}
					/>
				</div>
			</div>

			<ListingGallery
				galleryHref={`/homes/${listing.id}/gallery`}
				photos={listing.photos}
				title={listing.title}
			/>

			<div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[1fr_400px]">
				<div className="flex min-w-0 flex-col gap-10">
					<section className="flex flex-col gap-4">
						{capacityParts(listing).length > 0 && (
							<p className="text-muted-foreground">
								{capacityParts(listing).join(" · ")}
							</p>
						)}
						<div className="flex flex-wrap gap-4 text-muted-foreground text-sm">
							{listing.petFriendly && (
								<span className="flex items-center gap-1.5">
									<Dog className="size-4" /> Pets are welcome
								</span>
							)}
							{listing.capacity.guests && (
								<span className="flex items-center gap-1.5">
									<Users className="size-4" /> {listing.capacity.guests} guests
								</span>
							)}
							{listing.capacity.bedrooms && (
								<span className="flex items-center gap-1.5">
									<DoorOpen className="size-4" /> {listing.capacity.bedrooms}{" "}
									{listing.capacity.bedrooms === 1 ? "bedroom" : "bedrooms"}
								</span>
							)}
							{listing.capacity.beds && (
								<span className="flex items-center gap-1.5">
									<Bed className="size-4" /> {listing.capacity.beds} beds
								</span>
							)}
							{listing.capacity.bathrooms && (
								<span className="flex items-center gap-1.5">
									<Bath className="size-4" /> {listing.capacity.bathrooms} baths
								</span>
							)}
						</div>
					</section>

					<Separator />

					{(listing.description || listing.descriptionSections.length > 0) && (
						<section className="flex flex-col gap-6">
							<h2 className="font-heading font-semibold text-2xl">
								About this place
							</h2>
							{listing.description && (
								<p className="whitespace-pre-line text-sm leading-relaxed">
									{listing.description}
								</p>
							)}
							{listing.descriptionSections.map((section) => (
								<div key={section.key} className="flex flex-col gap-2">
									<h3 className="font-medium text-base">{section.label}</h3>
									<p className="whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
										{section.body}
									</p>
								</div>
							))}
						</section>
					)}

					{sleepingRooms.length > 0 && (
						<section className="flex flex-col gap-4">
							<h2 className="font-heading font-semibold text-2xl">
								Where you'll sleep
							</h2>
							<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
								{sleepingRooms.map((room, index) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: rooms have no stable id
										key={`${room.name ?? "room"}-${index}`}
										className="flex flex-col gap-2 rounded-xl border p-4"
									>
										<Bed className="size-6" />
										<span className="font-medium text-sm">
											{roomName(room, index)}
										</span>
										<span className="text-muted-foreground text-xs">
											{roomBeds(room)}
										</span>
									</div>
								))}
							</div>
						</section>
					)}

					<Separator />

					<ListingAmenities amenities={listing.amenities} />

					<Separator />

					<ListingReviews
						average={listing.reviews.average}
						averages={reviewData.averages}
						count={listing.reviews.count}
						reviews={reviewData.reviews}
					/>

					<Separator />

					<ListingLocation location={listing.location} />

					<Separator />

					<ListingCancellationPolicy />
				</div>

				<BookingWidget
					currency={config.currency}
					listingId={listing.id}
					maxGuests={listing.capacity.guests}
					minNights={listing.minNights}
					petFriendly={listing.petFriendly}
				/>
			</div>
		</div>
	);
}

function ListingSkeleton() {
	return (
		<div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
			<Skeleton className="mb-2 h-8 w-2/3" />
			<Skeleton className="mb-6 h-4 w-1/3" />
			<Skeleton className="h-112 w-full rounded-2xl" />
			<div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[1fr_400px]">
				<div className="flex flex-col gap-4">
					<Skeleton className="h-5 w-1/2" />
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-32 w-full" />
				</div>
				<Skeleton className="hidden h-96 w-full rounded-2xl lg:block" />
			</div>
		</div>
	);
}

export default function ListingPage(props: ListingPageProps) {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="flex-1 pt-16 pb-28 lg:pb-12">
				<Suspense fallback={<ListingSkeleton />}>
					<ListingContent params={props.params} />
				</Suspense>
			</main>
			<SiteFooter />
		</div>
	);
}
