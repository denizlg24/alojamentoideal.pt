import type {
	ActivityDifficulty,
	ActivitySummary,
} from "@workspace/core/activities";
import { difficultyLabel } from "@workspace/core/activities";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Clock, MapPin, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatActivityMoney, formatDuration } from "@/lib/activities/format";

const DIFFICULTY_DOT_CLASS = {
	very_easy: "bg-emerald-400",
	easy: "bg-green-500",
	moderate: "bg-amber-400",
	challenging: "bg-orange-500",
	demanding: "bg-rose-500",
	extreme: "bg-red-600",
} as const satisfies Record<ActivityDifficulty, string>;

function metaLocation(summary: ActivitySummary): string | null {
	const city = summary.location?.city?.trim();
	return city && city.length > 0 ? city : null;
}

export function ActivityCard({ activity }: { activity: ActivitySummary }) {
	const href = `/activities/${activity.id}`;
	const duration = formatDuration(activity.duration);
	const location = metaLocation(activity);
	const fromPrice = formatActivityMoney(activity.fromPrice);

	return (
		<Link
			href={href}
			className="group flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<div className="relative aspect-video overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-lg">
				{activity.coverPhoto ? (
					<Image
						src={activity.coverPhoto.url}
						alt={activity.coverPhoto.alt ?? activity.title}
						fill
						sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
						className="object-cover transition-transform duration-500 group-hover:scale-105"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
						No photo
					</div>
				)}
				{activity.difficulty && (
					<Badge
						variant="secondary"
						className="absolute top-3 left-3 gap-1 bg-background/85 shadow-sm backdrop-blur-md"
					>
						<span
							aria-hidden="true"
							className={`size-2.5 rounded-full ${DIFFICULTY_DOT_CLASS[activity.difficulty]}`}
						/>
						{difficultyLabel(activity.difficulty)}
					</Badge>
				)}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="line-clamp-1 font-medium leading-tight">
						{activity.title}
					</h3>
					{activity.rating !== null && (
						<span className="flex shrink-0 items-center gap-1 text-sm">
							<Star className="size-3.5 fill-current text-amber-500" />
							<span className="font-medium">{activity.rating.toFixed(1)}</span>
						</span>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
					{duration && (
						<span className="flex items-center gap-1.5">
							<Clock className="size-3.5" />
							{duration}
						</span>
					)}
					{location && (
						<span className="flex items-center gap-1.5">
							<MapPin className="size-3.5" />
							{location}
						</span>
					)}
				</div>

				{activity.excerpt && (
					<p className="line-clamp-2 text-muted-foreground text-sm">
						{activity.excerpt}
					</p>
				)}

				{fromPrice && (
					<p className="pt-0.5 text-sm">
						<span className="text-muted-foreground">from </span>
						<span className="font-semibold">{fromPrice}</span>
						<span className="text-muted-foreground"> / person</span>
					</p>
				)}
			</div>
		</Link>
	);
}

export function ActivityCardSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="aspect-video rounded-lg" />
			<div className="flex flex-col gap-2">
				<Skeleton className="h-5 w-2/3" />
				<Skeleton className="h-4 w-1/2" />
				<Skeleton className="h-4 w-1/3" />
			</div>
		</div>
	);
}
