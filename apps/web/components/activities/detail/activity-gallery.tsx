import type { ActivityPhoto } from "@workspace/core/activities";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
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
	photo: ActivityPhoto;
	sizes: string;
	title: string;
}) {
	return (
		<Image
			src={photo.url}
			alt={photo.alt ?? title}
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

export function ActivityGallery({
	galleryHref,
	photos,
	title,
}: {
	galleryHref: string;
	photos: ActivityPhoto[];
	title: string;
}) {
	const hero = photos[0];
	if (!hero) {
		return (
			<div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground md:aspect-[2/1]">
				No photos
			</div>
		);
	}

	const rest = photos.slice(1);
	const grid = rest.slice(0, 4);

	if (grid.length === 0) {
		return (
			<div className="relative">
				<Link
					href={photoHref(galleryHref, 0)}
					className="relative block aspect-[16/10] w-full overflow-hidden rounded-2xl bg-muted transition-opacity hover:opacity-95 md:aspect-[2/1]"
					aria-label="Open all photos"
				>
					<GalleryImage
						eager
						photo={hero}
						title={title}
						sizes="(max-width: 1024px) 100vw, 1024px"
					/>
				</Link>
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
		);
	}

	return (
		<div className="relative grid grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:h-[26rem]">
			<Link
				href={photoHref(galleryHref, 0)}
				className="relative col-span-4 row-span-2 aspect-[16/10] bg-muted transition-opacity hover:opacity-95 md:col-span-2 md:aspect-auto"
				aria-label="Open all photos"
			>
				<GalleryImage
					eager
					photo={hero}
					title={title}
					sizes="(max-width: 768px) 100vw, 50vw"
				/>
			</Link>
			{grid.map((photo, index) => (
				<Link
					key={photo.url}
					href={photoHref(galleryHref, index + 1)}
					className={cn(
						"relative hidden bg-muted transition-opacity hover:opacity-95 md:block",
						grid.length <= 2 ? "col-span-2 row-span-2" : "col-span-1",
					)}
					aria-label={`Open all photos at photo ${index + 2}`}
				>
					<GalleryImage photo={photo} title={title} sizes="25vw" />
					{index === grid.length - 1 && rest.length > grid.length && (
						<div className="absolute inset-0 flex items-center justify-center bg-black/40 font-medium text-lg text-white">
							+{rest.length - grid.length}
						</div>
					)}
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
	);
}
