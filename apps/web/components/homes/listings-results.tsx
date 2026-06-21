import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@workspace/ui/components/pagination";
import { Fragment } from "react";
import { ListingCard } from "@/components/listings/listing-card";
import type { ListingCardPrice } from "@/lib/catalog/pricing-display";

interface ListingsResultsProps {
	currentParams: URLSearchParams;
	limit: number;
	listings: CatalogListingSummaryDto[];
	offset: number;
	prices?: Map<string, ListingCardPrice>;
	stayQuery?: string;
	total: number;
}

function pageHref(params: URLSearchParams, offset: number): string {
	const next = new URLSearchParams(params);
	if (offset <= 0) {
		next.delete("offset");
	} else {
		next.set("offset", String(offset));
	}
	const query = next.toString();
	return query ? `/homes?${query}` : "/homes";
}

/** Page numbers to render, collapsing long ranges around the current page. */
function pageWindow(current: number, totalPages: number): number[] {
	const pages = new Set<number>([1, totalPages, current]);
	for (const delta of [-1, 1]) {
		const candidate = current + delta;
		if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
	}
	return [...pages].sort((a, b) => a - b);
}

export function ListingsResults({
	currentParams,
	limit,
	listings,
	offset,
	prices,
	stayQuery,
	total,
}: ListingsResultsProps) {
	if (total === 0) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
				<p className="font-medium">No homes match your search</p>
				<p className="text-muted-foreground text-sm">
					Try a different area or fewer filters.
				</p>
			</div>
		);
	}

	const totalPages = Math.max(1, Math.ceil(total / limit));
	const currentPage = Math.max(
		1,
		Math.min(Math.floor(offset / limit) + 1, totalPages),
	);
	const pages = pageWindow(currentPage, totalPages);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4">
				{listings.map((listing) => (
					<ListingCard
						key={listing.id}
						layout="row"
						listing={listing}
						price={prices?.get(listing.id)}
						stayQuery={stayQuery}
					/>
				))}
			</div>

			{totalPages > 1 && (
				<Pagination>
					<PaginationContent>
						<PaginationItem>
							<PaginationPrevious
								href={pageHref(currentParams, (currentPage - 2) * limit)}
								aria-disabled={currentPage <= 1}
								className={
									currentPage <= 1
										? "pointer-events-none opacity-50"
										: undefined
								}
							/>
						</PaginationItem>

						{pages.map((page, index) => {
							const previous = pages[index - 1];
							const showEllipsis =
								previous !== undefined && page - previous > 1;
							return (
								<Fragment key={page}>
									{showEllipsis && (
										<PaginationItem>
											<PaginationEllipsis />
										</PaginationItem>
									)}
									<PaginationItem>
										<PaginationLink
											href={pageHref(currentParams, (page - 1) * limit)}
											isActive={page === currentPage}
										>
											{page}
										</PaginationLink>
									</PaginationItem>
								</Fragment>
							);
						})}

						<PaginationItem>
							<PaginationNext
								href={pageHref(currentParams, currentPage * limit)}
								aria-disabled={currentPage >= totalPages}
								className={
									currentPage >= totalPages
										? "pointer-events-none opacity-50"
										: undefined
								}
							/>
						</PaginationItem>
					</PaginationContent>
				</Pagination>
			)}
		</div>
	);
}
