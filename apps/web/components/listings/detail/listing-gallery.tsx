"use client";

import type { CatalogPhotoDto } from "@workspace/core/catalog";
import { Button } from "@workspace/ui/components/button";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "@workspace/ui/components/carousel";
import { Grip } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

function GalleryImage({
	eager,
	photo,
	sizes,
	title,
}: {
	eager?: boolean;
	photo: CatalogPhotoDto;
	sizes: string;
	title: string;
}) {
	return (
		<Image
			src={photo.url}
			alt={photo.caption ?? title}
			fill
			fetchPriority={eager ? "high" : undefined}
			loading={eager ? "eager" : "lazy"}
			sizes={sizes}
			className="object-cover"
		/>
	);
}

function photoHref(galleryHref: string, index: number): string {
	return `${galleryHref}#photo-${index}`;
}

export function ListingGallery({
	galleryHref,
	photos,
	title,
}: {
	galleryHref: string;
	photos: CatalogPhotoDto[];
	title: string;
}) {
	if (photos.length === 0) {
		return (
			<div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground md:aspect-[2/1]">
				No photos
			</div>
		);
	}

	const [hero, ...rest] = photos;
	const grid = rest.slice(0, 4);

	return (
		<>
			{/* Mobile: swipeable carousel */}
			<div className="relative md:hidden">
				<Carousel className="w-full">
					<CarouselContent>
						{photos.map((photo, index) => (
							<CarouselItem key={photo.url}>
								<Link
									href={photoHref(galleryHref, index)}
									className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted"
									aria-label={`Open all photos at photo ${index + 1}`}
								>
									<GalleryImage
										eager={index === 0}
										photo={photo}
										sizes="100vw"
										title={title}
									/>
								</Link>
							</CarouselItem>
						))}
					</CarouselContent>
				</Carousel>
				<Button
					asChild
					variant="secondary"
					size="sm"
					className="absolute right-3 bottom-3 z-10 gap-2 shadow-md"
				>
					<Link href={galleryHref}>
						<Grip className="size-4" />
						Show all photos
					</Link>
				</Button>
			</div>

			{/* Desktop: hero grid */}
			<div className="relative hidden h-[28rem] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:grid">
				{hero && (
					<Link
						href={photoHref(galleryHref, 0)}
						className="relative col-span-2 row-span-2 overflow-hidden bg-muted transition-opacity hover:opacity-95"
						aria-label="Open all photos"
					>
						<GalleryImage photo={hero} eager sizes="50vw" title={title} />
					</Link>
				)}
				{grid.map((photo, index) => (
					<Link
						key={photo.url}
						href={photoHref(galleryHref, index + 1)}
						className="relative overflow-hidden bg-muted transition-opacity hover:opacity-95"
						aria-label={`Open all photos at photo ${index + 2}`}
					>
						<GalleryImage photo={photo} sizes="25vw" title={title} />
					</Link>
				))}
				<Button
					asChild
					variant="secondary"
					size="sm"
					className="absolute right-4 bottom-4 gap-2 shadow-md"
				>
					<Link href={galleryHref}>
						<Grip className="size-4" />
						Show all photos
					</Link>
				</Button>
			</div>
		</>
	);
}
