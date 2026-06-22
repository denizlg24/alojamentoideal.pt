"use client";

import type {
	ListingReviewCategoryAverages,
	ListingReviewDto,
} from "@workspace/core/listing-reviews";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { format, isValid, parseISO } from "date-fns";
import { Star } from "lucide-react";
import { useState } from "react";

const CATEGORY_LABELS: {
	key: keyof ListingReviewCategoryAverages;
	label: string;
}[] = [
	{ key: "cleanliness", label: "Cleanliness" },
	{ key: "accuracy", label: "Accuracy" },
	{ key: "checkin", label: "Check-in" },
	{ key: "communication", label: "Communication" },
	{ key: "location", label: "Location" },
	{ key: "value", label: "Value" },
];

const PREVIEW_COUNT = 6;

function channelLabel(review: ListingReviewDto): string {
	if (review.source === "internal") return "Direct booking";
	if (!review.channel) return "Verified stay";
	return review.channel.charAt(0).toUpperCase() + review.channel.slice(1);
}

function initials(name: string | null): string {
	if (!name) return "G";
	return name
		.split(" ")
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase())
		.join("");
}

function Stars({ rating }: { rating: number | null }) {
	if (rating === null) return null;
	const filled = Math.round(rating);
	return (
		<span
			role="img"
			className="flex items-center gap-0.5"
			aria-label={`${rating} out of 5`}
		>
			{Array.from({ length: 5 }, (_, index) => (
				<Star
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-star scale
					key={index}
					className={cn(
						"size-3.5",
						index < filled
							? "fill-foreground text-foreground"
							: "text-muted-foreground/40",
					)}
				/>
			))}
		</span>
	);
}

function ReviewCard({ review }: { review: ListingReviewDto }) {
	const [expanded, setExpanded] = useState(false);
	const reviewedDate = review.reviewedAt ? parseISO(review.reviewedAt) : null;
	const reviewedLabel =
		reviewedDate && isValid(reviewedDate)
			? format(reviewedDate, "MMMM yyyy")
			: "";
	const long = review.comments.length > 240;
	const text =
		expanded || !long ? review.comments : `${review.comments.slice(0, 240)}…`;

	return (
		<article className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<Avatar>
					<AvatarFallback>{initials(review.guestName)}</AvatarFallback>
				</Avatar>
				<div className="flex min-w-0 flex-col">
					<span className="font-medium text-sm">
						{review.guestName ?? "Guest"}
					</span>
					<span className="text-muted-foreground text-xs">{reviewedLabel}</span>
				</div>
				<Badge variant="secondary" className="ml-auto shrink-0">
					{channelLabel(review)}
				</Badge>
			</div>
			<div className="flex items-center gap-2">
				<Stars rating={review.rating} />
			</div>
			<p className="text-sm leading-relaxed">{text}</p>
			{long && (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="w-fit font-medium text-sm underline underline-offset-2"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</article>
	);
}

export function ListingReviews({
	average,
	averages,
	count,
	reviews,
}: {
	average: number | null;
	averages: ListingReviewCategoryAverages;
	count: number;
	reviews: ListingReviewDto[];
}) {
	if (count === 0 || reviews.length === 0) {
		return null;
	}

	const categories = CATEGORY_LABELS.filter(
		({ key }) => averages[key] !== null,
	);
	const preview = reviews.slice(0, PREVIEW_COUNT);

	return (
		<section className="flex flex-col gap-6">
			<h2 className="flex items-center gap-2 font-heading font-semibold text-2xl">
				<Star className="size-5 fill-foreground" />
				{average !== null ? average.toFixed(2) : "New"} · {count}{" "}
				{count === 1 ? "review" : "reviews"}
			</h2>

			{categories.length > 0 && (
				<div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
					{categories.map(({ key, label }) => (
						<div
							key={key}
							className="flex items-center justify-between border-b pb-2 text-sm"
						>
							<span className="text-muted-foreground">{label}</span>
							<span className="font-medium">{averages[key]?.toFixed(1)}</span>
						</div>
					))}
				</div>
			)}

			<div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
				{preview.map((review) => (
					<ReviewCard key={review.id} review={review} />
				))}
			</div>

			{reviews.length > PREVIEW_COUNT && (
				<Dialog>
					<DialogTrigger asChild>
						<Button variant="outline" className="w-fit">
							Show all {count} reviews
						</Button>
					</DialogTrigger>
					<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>
								{average !== null ? average.toFixed(2) : "New"} · {count}{" "}
								reviews
							</DialogTitle>
						</DialogHeader>
						<div className="grid grid-cols-1 gap-8 pt-2">
							{reviews.map((review) => (
								<ReviewCard key={review.id} review={review} />
							))}
						</div>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
}
