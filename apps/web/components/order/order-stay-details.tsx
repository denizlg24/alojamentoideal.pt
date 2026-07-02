import type { CatalogListingDetailDto } from "@workspace/core/catalog";
import { Separator } from "@workspace/ui/components/separator";
import { Fragment, type ReactNode } from "react";
import { ListingAmenities } from "@/components/listings/detail/listing-amenities";
import { ListingGallery } from "@/components/listings/detail/listing-gallery";
import { ListingLocation } from "@/components/listings/detail/listing-location";

/**
 * The processed guide is a plain string assembled from labeled sections
 * (`Heading\nbody`, blank line between sections). Split it back into sections so
 * each heading renders as a subheading; blocks with no body still render their
 * heading. Kept lenient so a stray blank line never breaks the layout.
 */
function toGuideSections(guide: string): { body: string; heading: string }[] {
	return guide
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0)
		.map((block) => {
			const [heading = "", ...rest] = block.split("\n");
			return { body: rest.join("\n").trim(), heading: heading.trim() };
		});
}

function GuideBlock({ guide }: { guide: string }) {
	const sections = toGuideSections(guide);

	return (
		<section className="flex flex-col gap-4">
			<h2 className="font-heading font-semibold text-2xl">House guide</h2>
			<div className="flex flex-col gap-4">
				{sections.map((section) => (
					<div
						className="flex flex-col gap-1"
						key={`${section.heading}-${section.body.slice(0, 20)}`}
					>
						<h3 className="font-heading font-medium text-base">
							{section.heading}
						</h3>
						{section.body.length > 0 && (
							<p className="whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
								{section.body}
							</p>
						)}
					</div>
				))}
			</div>
		</section>
	);
}

/**
 * The stay-details blocks for a single home, reusing the public listing sections
 * (gallery, amenities, guide, map). Blocks that have no content are dropped along
 * with their separator so the layout never shows an orphan divider.
 */
function StayListing({ listing }: { listing: CatalogListingDetailDto }) {
	const blocks: { key: string; node: ReactNode }[] = [
		{
			key: "gallery",
			node: (
				<ListingGallery
					galleryHref={`/homes/${listing.id}/gallery`}
					photos={listing.photos}
					title={listing.title}
				/>
			),
		},
	];

	if (listing.amenities.length > 0) {
		blocks.push({
			key: "amenities",
			node: <ListingAmenities amenities={listing.amenities} />,
		});
	}

	if (listing.guide.trim().length > 0) {
		blocks.push({ key: "guide", node: <GuideBlock guide={listing.guide} /> });
	}

	if (
		listing.location.latitude !== null &&
		listing.location.longitude !== null
	) {
		blocks.push({
			key: "location",
			node: <ListingLocation location={listing.location} />,
		});
	}

	return (
		<>
			{blocks.map((block, index) => (
				<Fragment key={block.key}>
					{index > 0 && <Separator />}
					{block.node}
				</Fragment>
			))}
		</>
	);
}

/**
 * Order-hub "Stay" section: the property-level details for each booked home,
 * shown to every guest on the order. Content mirrors the public listing page but
 * lives inside the authenticated order context.
 */
export function OrderStayDetails({
	stays,
}: {
	stays: CatalogListingDetailDto[];
}) {
	const multiHome = stays.length > 1;

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">Stay details</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Everything about your home: photos, what's included, how to get there,
					and the house guide.
				</p>
			</div>

			{stays.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Stay details aren't available for this booking yet.
				</p>
			) : (
				stays.map((listing, index) => (
					<section className="flex flex-col gap-6" key={listing.id}>
						{multiHome && (
							<h3 className="font-heading font-medium text-sm">
								{listing.title}
							</h3>
						)}
						<StayListing listing={listing} />
						{index < stays.length - 1 && <Separator className="mt-2" />}
					</section>
				))
			)}
		</div>
	);
}
