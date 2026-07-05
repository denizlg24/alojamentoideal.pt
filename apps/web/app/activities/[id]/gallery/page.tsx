import type { ActivityLocation } from "@workspace/core/activities";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivityPhotoGallery } from "@/components/activities/detail/activity-photo-gallery";
import {
	generateActivityStaticParams,
	getActivityCatalogScope,
	getCachedActivityDetail,
} from "@/lib/activities/source";
import { buildPageMetadata } from "@/lib/site/metadata";

interface ActivityGalleryPageProps {
	params: Promise<{ id: string }>;
}

export function generateStaticParams(): Promise<{ id: string }[]> {
	return generateActivityStaticParams();
}

export async function generateMetadata({
	params,
}: ActivityGalleryPageProps): Promise<Metadata> {
	const { id } = await params;
	const activity = await getCachedActivityDetail(id, getActivityCatalogScope());
	if (!activity) {
		return {
			title: "Activity photos not found",
			robots: { follow: true, index: false },
		};
	}

	const title = `${activity.title} photos`;
	return buildPageMetadata({
		title,
		description: `Browse ${activity.photos.length} photos of ${activity.title}.`,
		path: `/activities/${id}/gallery`,
		image: activity.coverPhoto?.url,
	});
}

function locationLabel(location: ActivityLocation | null): string | null {
	if (!location) return null;
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
						<Link href={backHref} aria-label="Back to activity">
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
						This activity does not have gallery photos yet.
					</p>
				</div>
			</main>
		</div>
	);
}

async function GalleryContent({
	params,
}: {
	params: ActivityGalleryPageProps["params"];
}) {
	const { id } = await params;
	if (id === "__ci_placeholder__") {
		notFound();
	}

	const activity = await getCachedActivityDetail(id, getActivityCatalogScope());
	if (!activity) {
		notFound();
	}

	const backHref = `/activities/${activity.id}`;
	if (activity.photos.length === 0) {
		return <EmptyGallery backHref={backHref} title={activity.title} />;
	}

	return (
		<ActivityPhotoGallery
			backHref={backHref}
			locationLabel={locationLabel(activity.location)}
			photos={activity.photos}
			title={activity.title}
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

export default function ActivityGalleryPage(props: ActivityGalleryPageProps) {
	return (
		<Suspense fallback={<GallerySkeleton />}>
			<GalleryContent params={props.params} />
		</Suspense>
	);
}
