"use client";

import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { Star } from "lucide-react";
import { useState } from "react";
import type { OrderReviewItemState } from "@/lib/order/reviews";

function StarPicker({
	onChange,
	value,
}: {
	onChange: (rating: number) => void;
	value: number;
}) {
	return (
		<div className="flex items-center gap-1">
			{[1, 2, 3, 4, 5].map((rating) => (
				<button
					aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
					aria-pressed={value === rating}
					className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					key={rating}
					onClick={() => onChange(rating)}
					type="button"
				>
					<Star
						className={cn(
							"size-6",
							rating <= value
								? "fill-amber-500 text-amber-500"
								: "text-muted-foreground/40",
						)}
					/>
				</button>
			))}
		</div>
	);
}

function ExistingReview({
	review,
}: {
	review: NonNullable<OrderReviewItemState["existing"]>;
}) {
	return (
		<div className="flex flex-col gap-2">
			{review.rating !== null && (
				<div className="flex items-center gap-1">
					{[1, 2, 3, 4, 5].map((rating) => (
						<Star
							key={rating}
							className={cn(
								"size-4",
								rating <= (review.rating ?? 0)
									? "fill-amber-500 text-amber-500"
									: "text-muted-foreground/40",
							)}
						/>
					))}
				</div>
			)}
			{review.comments && (
				<p className="text-muted-foreground text-sm">{review.comments}</p>
			)}
			<p className="text-muted-foreground text-xs">
				{review.status === "published"
					? "Thanks for sharing! Your review is live."
					: "Thanks for sharing! Your review is awaiting moderation."}
			</p>
		</div>
	);
}

function ReviewForm({
	itemId,
	reference,
}: {
	itemId: string;
	reference: string;
}) {
	const [rating, setRating] = useState(0);
	const [comments, setComments] = useState("");
	const [state, setState] = useState<"error" | "idle" | "pending" | "sent">(
		"idle",
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	if (state === "sent") {
		return (
			<p className="text-muted-foreground text-sm">
				Thanks for sharing! Your review is awaiting moderation.
			</p>
		);
	}

	const submit = async () => {
		setState("pending");
		setErrorMessage(null);
		try {
			const response = await fetch(`/api/orders/${reference}/reviews`, {
				body: JSON.stringify({ comments, itemId, rating }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				setErrorMessage(
					body?.error ?? "Something went wrong. Please try again.",
				);
				setState("error");
				return;
			}
			setState("sent");
		} catch {
			setErrorMessage("Something went wrong. Please try again.");
			setState("error");
		}
	};

	return (
		<div className="flex flex-col items-start gap-3">
			<StarPicker onChange={setRating} value={rating} />
			<Textarea
				className="min-h-24"
				maxLength={2000}
				onChange={(event) => setComments(event.target.value)}
				placeholder="What made your stay special? Anything we could improve?"
				value={comments}
			/>
			{errorMessage && (
				<p className="text-destructive text-sm">{errorMessage}</p>
			)}
			<Button
				className="rounded-full"
				disabled={rating === 0 || state === "pending"}
				onClick={submit}
				size="sm"
				type="button"
			>
				{state === "pending" ? "Sending..." : "Submit review"}
			</Button>
		</div>
	);
}

/**
 * "Share your experience" section on the order hub: one review card per stay,
 * shown to the order owner once the booking is confirmed. Stays that have not
 * started yet get a hint instead of the form.
 */
export function OrderReviewSection({
	items,
	reference,
}: {
	items: OrderReviewItemState[];
	reference: string;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col gap-2">
			<h2 className="font-heading font-medium text-base">
				Share your experience
			</h2>
			<div className="flex flex-col gap-3">
				{items.map((item) => (
					<div
						className="flex flex-col gap-3 rounded-xl border bg-card p-4"
						key={item.itemId}
					>
						<p className="font-medium text-sm">{item.title}</p>
						{item.existing ? (
							<ExistingReview review={item.existing} />
						) : item.stayStarted ? (
							<ReviewForm itemId={item.itemId} reference={reference} />
						) : (
							<p className="text-muted-foreground text-sm">
								You can leave a review after your stay begins.
							</p>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
