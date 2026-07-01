import type { CatalogLocationDto } from "@workspace/core/catalog";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingPhotoGallery } from "@/components/listings/detail/listing-photo-gallery";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import {
	generateListingStaticParams,
	getListingCatalogScope,
} from "@/lib/catalog/listing-route";
import { buildPageMetadata } from "@/lib/site/metadata";

interface ListingGalleryPageProps {
	params: Promise<{ id: string }>;
}

export async function generateStaticParams(): Promise<{ id: string }[]> {
	return generateListingStaticParams();
}

export async function generateMetadata({
	params,
}: ListingGalleryPageProps): Promise<Metadata> {
	const { id } = await params;
	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	if (!listing) {
		return {
			title: "Listing photos not found",
			robots: { follow: true, index: false },
		};
	}

	const title = `${listing.title} photos`;
	return buildPageMetadata({
		title,
		description: `Browse ${listing.photos.length} photos of ${listing.title}.`,
		path: `/homes/${id}/galery`,
		image: listing.coverPhoto?.url,
	});
}

function locationLabel(location: CatalogLocationDto): string | null {
	return [location.city, location.country].filter(Boolean).join(", ") || null;
}

function EmptyGallery({
	backHref,
	title,
}: {
	backHref: string;
	title: string;
}) {
	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="border-b">
				<div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
					<Button asChild variant="ghost" size="icon" className="rounded-full">
						<Link href={backHref} aria-label="Back to Homes">
							<ArrowLeft className="size-5" />
						</Link>
					</Button>
					<p className="truncate font-heading font-semibold text-base sm:text-lg">
						{title}
					</p>
				</div>
			</header>
			<main className="flex flex-1 items-center justify-center px-4">
				<div className="text-center">
					<h1 className="font-heading font-semibold text-2xl">No photos</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						This home does not have gallery photos yet.
					</p>
				</div>
			</main>
		</div>
	);
}

async function GalleryContent({
	params,
}: {
	params: ListingGalleryPageProps["params"];
}) {
	const { id } = await params;

	if (id === "__ci_placeholder__") {
		notFound();
	}

	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	if (!listing) {
		notFound();
	}

	const backHref = `/homes/${listing.id}`;
	if (listing.photos.length === 0) {
		return <EmptyGallery backHref={backHref} title={listing.title} />;
	}

	return (
		<ListingPhotoGallery
			backHref={backHref}
			locationLabel={locationLabel(listing.location)}
			photos={listing.photos}
			title={listing.title}
		/>
	);
}

function GallerySkeleton() {
	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
					<Skeleton className="size-9 rounded-full" />
					<div className="flex flex-1 justify-center">
						<Skeleton className="h-5 w-48" />
					</div>
					<Skeleton className="size-9 rounded-full" />
				</div>
				<div className="border-t">
					<div className="mx-auto flex max-w-7xl gap-3 overflow-hidden px-4 py-3 sm:px-6">
						{Array.from({ length: 6 }).map((_, index) => (
							<Skeleton
								// biome-ignore lint/suspicious/noArrayIndexKey: skeleton slots are static placeholders
								key={index}
								className="h-28 w-28 shrink-0 rounded-xl sm:w-36"
							/>
						))}
					</div>
				</div>
			</header>
			<main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
				<div className="hidden lg:block">
					<Skeleton className="h-8 w-36" />
					<Skeleton className="mt-3 h-16 w-44" />
				</div>
				<div className="columns-2 gap-1.5 sm:gap-2">
					{Array.from({ length: 10 }).map((_, index) => (
						<Skeleton
							// biome-ignore lint/suspicious/noArrayIndexKey: skeleton slots are static placeholders
							key={index}
							className="mb-2 h-52 w-full break-inside-avoid rounded-xl"
						/>
					))}
				</div>
			</main>
		</div>
	);
}

export default function ListingGalleryPage(props: ListingGalleryPageProps) {
	return (
		<Suspense fallback={<GallerySkeleton />}>
			<GalleryContent params={props.params} />
		</Suspense>
	);
}
