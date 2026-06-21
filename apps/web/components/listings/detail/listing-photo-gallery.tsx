"use client";

import type { CatalogPhotoDto } from "@workspace/core/catalog";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	ArrowLeft,
	Check,
	ChevronLeft,
	ChevronRight,
	Grid2X2,
	Share2,
	X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const MAX_RAIL_ITEMS = 10;

interface ListingPhotoGalleryProps {
	backHref: string;
	locationLabel: string | null;
	photos: CatalogPhotoDto[];
	title: string;
}

interface GalleryStop {
	index: number;
	label: string;
	photo: CatalogPhotoDto;
}

function photoCountLabel(count: number): string {
	return `${count} ${count === 1 ? "photo" : "photos"}`;
}

function titleCase(value: string): string {
	return value
		.toLowerCase()
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanLabel(value: string | null | undefined): string | null {
	const label = value?.trim();
	if (!label) return null;
	return titleCase(label);
}

function photoLabel(photo: CatalogPhotoDto, index: number): string {
	if (index === 0) return "Overview";
	return cleanLabel(photo.caption) ?? `Photo ${index + 1}`;
}

function galleryStops(photos: CatalogPhotoDto[]): GalleryStop[] {
	const stops: GalleryStop[] = [];
	const seenCaptions = new Set<string>();

	for (const [index, photo] of photos.entries()) {
		const label = photoLabel(photo, index);
		const normalized = cleanLabel(photo.caption)?.toLowerCase();

		if (normalized) {
			if (seenCaptions.has(normalized)) continue;
			seenCaptions.add(normalized);
		}

		stops.push({ index, label, photo });
		if (stops.length >= MAX_RAIL_ITEMS) break;
	}

	return stops;
}

function imageAlt(
	photo: CatalogPhotoDto,
	title: string,
	index: number,
): string {
	return photo.caption
		? `${photo.caption} at ${title}`
		: `${title} photo ${index + 1}`;
}

function tileAspect(index: number): string {
	if (index % 11 === 0) return "aspect-[4/5]";
	if (index % 7 === 0) return "aspect-[3/4]";
	if (index % 5 === 0) return "aspect-square";
	return "aspect-[4/3]";
}

export function ListingPhotoGallery({
	backHref,
	locationLabel,
	photos,
	title,
}: ListingPhotoGalleryProps) {
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);
	const stops = useMemo(() => galleryStops(photos), [photos]);
	const activePhoto = activeIndex === null ? null : photos[activeIndex];
	const countLabel = photoCountLabel(photos.length);

	const closeLightbox = useCallback(() => setActiveIndex(null), []);
	const showPrevious = useCallback(() => {
		setActiveIndex((current) =>
			current === null ? null : (current - 1 + photos.length) % photos.length,
		);
	}, [photos.length]);
	const showNext = useCallback(() => {
		setActiveIndex((current) =>
			current === null ? null : (current + 1) % photos.length,
		);
	}, [photos.length]);

	useEffect(() => {
		if (activeIndex === null) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeLightbox();
			if (event.key === "ArrowLeft") showPrevious();
			if (event.key === "ArrowRight") showNext();
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [activeIndex, closeLightbox, showNext, showPrevious]);

	const shareListing = async () => {
		const url = new URL(backHref, window.location.origin).toString();

		try {
			if (navigator.share) {
				await navigator.share({ title, url });
				return;
			}

			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Sharing can be dismissed or blocked by browser permissions.
		}
	};

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
					<Button asChild variant="ghost" size="icon" className="rounded-full">
						<Link href={backHref} aria-label="Back to home details">
							<ArrowLeft className="size-5" />
						</Link>
					</Button>

					<div className="min-w-0 flex-1 text-center">
						<p className="truncate font-heading font-semibold text-base sm:text-lg">
							{title}
						</p>
						<p className="text-muted-foreground text-xs">{countLabel}</p>
					</div>

					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="rounded-full"
						onClick={shareListing}
						aria-label={copied ? "Listing link copied" : "Share this home"}
					>
						{copied ? (
							<Check className="size-5" />
						) : (
							<Share2 className="size-5" />
						)}
					</Button>
				</div>

				<nav className="border-t bg-background" aria-label="Photo shortcuts">
					<div className="mx-auto max-w-7xl overflow-x-auto px-4 py-3 sm:px-6">
						<div className="flex w-max gap-3">
							{stops.map((stop) => (
								<a
									key={`${stop.photo.url}-${stop.index}`}
									href={`#photo-${stop.index}`}
									className="group flex w-28 shrink-0 flex-col gap-2 text-left sm:w-36"
								>
									<span className="relative block aspect-4/3 overflow-hidden rounded-xl bg-muted">
										<Image
											src={stop.photo.thumbnailUrl ?? stop.photo.url}
											alt=""
											fill
											sizes="144px"
											className="object-cover transition-transform duration-300 group-hover:scale-105"
										/>
									</span>
									<span className="line-clamp-2 text-muted-foreground text-xs leading-tight group-hover:text-foreground">
										{stop.label}
									</span>
								</a>
							))}
						</div>
					</div>
				</nav>
			</header>

			<main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
				<aside className="hidden lg:block">
					<div className="sticky top-64">
						<h1 className="font-heading font-semibold text-3xl">Overview</h1>
						<p className="mt-3 max-w-44 text-muted-foreground text-sm leading-relaxed">
							{countLabel} from this home
							{locationLabel ? ` in ${locationLabel}` : ""}.
						</p>
					</div>
				</aside>

				<section aria-labelledby="gallery-overview" className="min-w-0">
					<h2 id="gallery-overview" className="sr-only">
						Overview
					</h2>
					<div className="mb-6 lg:hidden">
						<h1 className="font-heading font-semibold text-2xl">Overview</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							{countLabel}
							{locationLabel ? ` in ${locationLabel}` : ""}
						</p>
					</div>

					<div className="columns-2 gap-1.5 sm:gap-2">
						{photos.map((photo, index) => (
							<button
								id={`photo-${index}`}
								key={photo.url}
								type="button"
								className={cn(
									"relative mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-xl bg-muted text-left transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mb-2",
									"scroll-mt-44",
									tileAspect(index),
								)}
								onClick={() => setActiveIndex(index)}
								aria-label={`Open photo ${index + 1} of ${photos.length}`}
							>
								<Image
									src={photo.url}
									alt={imageAlt(photo, title, index)}
									fill
									fetchPriority={index === 0 ? "high" : undefined}
									loading={index === 0 ? "eager" : "lazy"}
									sizes="(max-width: 768px) 50vw, 42vw"
									className="object-cover"
								/>
							</button>
						))}
					</div>
				</section>
			</main>

			{activePhoto && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label={`${title} photo viewer`}
					className="fixed inset-0 z-50 bg-background"
				>
					<div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-8">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="rounded-full"
							onClick={closeLightbox}
							aria-label="Back to gallery"
						>
							<Grid2X2 className="size-5" />
						</Button>

						<div className="min-w-0 text-center">
							<p className="truncate font-medium text-sm sm:text-base">
								{photoLabel(activePhoto, activeIndex ?? 0)}
							</p>
							<p className="text-muted-foreground text-xs sm:text-sm">
								{(activeIndex ?? 0) + 1} of {photos.length}
							</p>
						</div>

						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="rounded-full"
							onClick={closeLightbox}
							aria-label="Close photo viewer"
						>
							<X className="size-5" />
						</Button>
					</div>

					<div className="relative flex h-[calc(100dvh-4rem)] items-center justify-center px-5 pb-8 sm:px-16">
						<div className="relative h-full w-full max-w-6xl">
							<Image
								src={activePhoto.url}
								alt={imageAlt(activePhoto, title, activeIndex ?? 0)}
								fill
								sizes="100vw"
								className="object-contain"
							/>
						</div>

						{photos.length > 1 && (
							<>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="absolute top-1/2 left-3 hidden -translate-y-1/2 rounded-full bg-background/80 shadow-sm sm:inline-flex"
									onClick={showPrevious}
									aria-label="Previous photo"
								>
									<ChevronLeft className="size-5" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-full bg-background/80 shadow-sm sm:inline-flex"
									onClick={showNext}
									aria-label="Next photo"
								>
									<ChevronRight className="size-5" />
								</Button>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
