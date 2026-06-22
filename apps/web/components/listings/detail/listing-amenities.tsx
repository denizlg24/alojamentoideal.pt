"use client";

import type { CatalogAmenityDto } from "@workspace/core/catalog";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { AmenityIcon } from "../amenity-icon";

const PREVIEW_COUNT = 10;

function AmenityRow({ amenity }: { amenity: CatalogAmenityDto }) {
	return (
		<div className="flex items-center gap-4 py-1">
			<AmenityIcon name={amenity.icon.name} className="size-5 shrink-0" />
			<span className="text-sm">{amenity.label}</span>
		</div>
	);
}

export function ListingAmenities({
	amenities,
}: {
	amenities: CatalogAmenityDto[];
}) {
	if (amenities.length === 0) {
		return null;
	}

	const preview = amenities.slice(0, PREVIEW_COUNT);

	return (
		<section className="flex flex-col gap-6">
			<h2 className="font-heading font-semibold text-2xl">
				What this place offers
			</h2>
			<div className="grid grid-cols-1 gap-x-12 gap-y-2 sm:grid-cols-2">
				{preview.map((amenity) => (
					<AmenityRow key={amenity.key} amenity={amenity} />
				))}
			</div>
			{amenities.length > PREVIEW_COUNT && (
				<Dialog>
					<DialogTrigger asChild>
						<Button variant="outline" className="w-fit">
							Show all {amenities.length} amenities
						</Button>
					</DialogTrigger>
					<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>What this place offers</DialogTitle>
						</DialogHeader>
						<div className="flex flex-col divide-y">
							{amenities.map((amenity) => (
								<AmenityRow key={amenity.key} amenity={amenity} />
							))}
						</div>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
}
