"use client";

import type { CatalogAmenityDto } from "@workspace/core/catalog";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { X } from "lucide-react";
import { FilterPill } from "@/components/homes/filter-pill";
import { AmenityIcon } from "./amenity-icon";

function amenityLabel(count: number): string {
	return `${count} ${count === 1 ? "amenity" : "amenities"}`;
}

export function ListingAmenitiesDialog({
	amenities,
	listingTitle,
}: {
	amenities: CatalogAmenityDto[];
	listingTitle: string;
}) {
	const count = amenities.length;
	if (count === 0) return null;

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="rounded-sm bg-transparent p-0 text-left font-medium underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					{amenityLabel(count)}
				</button>
			</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl"
			>
				<DialogHeader className="relative flex-row items-center justify-center border-b px-12 py-4">
					<DialogClose asChild>
						<Button variant="ghost" size="icon-sm" className="absolute left-3">
							<X className="size-4" />
							<span className="sr-only">Close</span>
						</Button>
					</DialogClose>
					<DialogTitle>Amenities</DialogTitle>
					<DialogDescription className="sr-only">
						Amenities available at {listingTitle}.
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto px-6 py-6">
					<div className="flex flex-wrap gap-2">
						{amenities.map((amenity) => (
							<FilterPill key={amenity.key} active>
								<span className="flex items-center gap-2">
									<AmenityIcon name={amenity.icon.name} className="size-4" />
									{amenity.label}
								</span>
							</FilterPill>
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
