"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Bookmark } from "lucide-react";
import { useSavedListings } from "./saved-listings-provider";

/**
 * Save/unsave control for a listing card. Signed-out clicks open the login
 * overlay via the shared saved-listings context.
 */
export function BookmarkButton({
	className,
	listingId,
	listingTitle,
}: {
	className?: string;
	listingId: string;
	listingTitle: string;
}) {
	const { isSaved, toggle } = useSavedListings();
	const saved = isSaved(listingId);

	return (
		<button
			aria-label={
				saved ? `Remove ${listingTitle} from bookmarks` : `Save ${listingTitle}`
			}
			aria-pressed={saved}
			className={cn(
				"flex size-8 items-center justify-center rounded-full border bg-background transition-colors hover:bg-accent",
				className,
			)}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				toggle(listingId);
			}}
			type="button"
		>
			<Bookmark
				className={cn(
					"size-4 transition-colors",
					saved && "fill-primary text-primary",
				)}
			/>
		</button>
	);
}
