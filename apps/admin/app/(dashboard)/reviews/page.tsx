import type { ListingReviewSource } from "@workspace/core/listing-reviews";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import {
	type AdminReviewRow,
	isReviewSourceFilter,
	isReviewStatusFilter,
	listAdminReviews,
	type ReviewStatusFilter,
} from "@/lib/reviews/list";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Reviews" };

interface ReviewsPageProps {
	searchParams: Promise<{ page?: string; source?: string; status?: string }>;
}

function pageHref(params: {
	page: number;
	source: string | null;
	status: string | null;
}): string {
	const search = new URLSearchParams();
	if (params.status) {
		search.set("status", params.status);
	}
	if (params.source) {
		search.set("source", params.source);
	}
	if (params.page > 0) {
		search.set("page", String(params.page));
	}
	const query = search.toString();
	return query ? `/reviews?${query}` : "/reviews";
}

function statusBadgeVariant(
	status: string,
): "default" | "destructive" | "outline" | "secondary" {
	switch (status) {
		case "published":
			return "default";
		case "pending":
			return "secondary";
		default:
			return "outline";
	}
}

function FilterPill({
	active,
	href,
	label,
}: {
	active: boolean;
	href: string;
	label: string;
}) {
	return (
		<Button
			asChild
			size="sm"
			variant={active ? "default" : "outline"}
			className="rounded-full"
		>
			<Link href={href}>{label}</Link>
		</Button>
	);
}

function RatingCell({ rating }: { rating: number | null }) {
	if (rating === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<span className="inline-flex items-center gap-1 tabular-nums">
			<Star className="size-3.5 fill-amber-500 text-amber-500" />
			{rating.toFixed(1)}
		</span>
	);
}

function reviewSummary(row: AdminReviewRow): string {
	if (!row.comments) {
		return "No comment";
	}
	return row.comments;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
	const params = await searchParams;
	const status: ReviewStatusFilter | null =
		params.status && isReviewStatusFilter(params.status) ? params.status : null;
	const source: ListingReviewSource | null =
		params.source && isReviewSourceFilter(params.source) ? params.source : null;
	const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

	const { hasNext, rows } = await listAdminReviews({ page, source, status });

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Reviews
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Guest reviews written on the site and reviews synced from external
						channels. Publishing a review makes it count toward the listing
						rating and show on its page.
					</p>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<FilterPill
					active={status === null && source === null}
					href="/reviews"
					label="All"
				/>
				<FilterPill
					active={status === "pending"}
					href={pageHref({ page: 0, source: null, status: "pending" })}
					label="Pending"
				/>
				<FilterPill
					active={status === "published"}
					href={pageHref({ page: 0, source: null, status: "published" })}
					label="Published"
				/>
				<FilterPill
					active={status === "hidden"}
					href={pageHref({ page: 0, source: null, status: "hidden" })}
					label="Hidden"
				/>
				<FilterPill
					active={source === "internal"}
					href={pageHref({ page: 0, source: "internal", status: null })}
					label="Written here"
				/>
				<FilterPill
					active={source === "external"}
					href={pageHref({ page: 0, source: "external", status: null })}
					label="From channels"
				/>
			</div>

			<Table className="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Listing</TableHead>
						<TableHead>Guest</TableHead>
						<TableHead>Rating</TableHead>
						<TableHead className="max-w-md">Review</TableHead>
						<TableHead>Source</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Date</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell
								className="py-10 text-center text-muted-foreground"
								colSpan={8}
							>
								No reviews match these filters.
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell className="font-medium">
									{row.listingName ?? row.listingExternalId}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{row.guestName ?? "—"}
								</TableCell>
								<TableCell>
									<RatingCell rating={row.rating} />
								</TableCell>
								<TableCell className="max-w-md">
									<p className="line-clamp-2 text-muted-foreground">
										{reviewSummary(row)}
									</p>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{row.source === "internal"
										? "Direct"
										: (row.channel ?? "External")}
								</TableCell>
								<TableCell>
									<Badge variant={statusBadgeVariant(row.status)}>
										{row.status}
									</Badge>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatDateTime(new Date(row.reviewedAt ?? row.createdAt))}
								</TableCell>
								<TableCell>
									<ReviewActions id={row.id} status={row.status} />
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>

			<div className="mt-4 flex items-center justify-end gap-2">
				<Button asChild disabled={page === 0} size="sm" variant="ghost">
					<Link
						aria-disabled={page === 0}
						className={page === 0 ? "pointer-events-none opacity-40" : ""}
						href={pageHref({ page: page - 1, source, status })}
					>
						Previous
					</Link>
				</Button>
				<Button asChild disabled={!hasNext} size="sm" variant="ghost">
					<Link
						aria-disabled={!hasNext}
						className={hasNext ? "" : "pointer-events-none opacity-40"}
						href={pageHref({ page: page + 1, source, status })}
					>
						Next
					</Link>
				</Button>
			</div>
		</div>
	);
}
