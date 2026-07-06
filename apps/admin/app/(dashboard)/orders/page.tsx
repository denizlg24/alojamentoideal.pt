import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import { formatDateTime, formatMoneyMinor } from "@/lib/format";
import { isOrderStatusFilter, listAdminOrders } from "@/lib/orders/list";
import { OrdersFilters } from "./orders-filters";

export const metadata: Metadata = { title: "Orders" };

interface OrdersPageProps {
	searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}

function pageHref(params: {
	page: number;
	q: string | null;
	status: string | null;
}): string {
	const search = new URLSearchParams();
	if (params.q) {
		search.set("q", params.q);
	}
	if (params.status) {
		search.set("status", params.status);
	}
	if (params.page > 0) {
		search.set("page", String(params.page));
	}
	const query = search.toString();
	return query ? `/orders?${query}` : "/orders";
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
	const params = await searchParams;
	const status =
		params.status && isOrderStatusFilter(params.status) ? params.status : null;
	const query = params.q?.trim() || null;
	const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

	const { hasNext, rows } = await listAdminOrders({ page, query, status });

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Orders
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Bookings across the reservation saga. Rows flagged with a warning
						have a provider booking that needs manual recovery.
					</p>
				</div>
				<OrdersFilters />
			</div>

			<Table className="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Reference</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Guest</TableHead>
						<TableHead className="text-right">Total</TableHead>
						<TableHead className="text-right">Paid</TableHead>
						<TableHead>Created</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell
								className="py-10 text-center text-muted-foreground"
								colSpan={6}
							>
								No orders match these filters.
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow key={row.publicReference}>
								<TableCell>
									<Link
										className="inline-flex items-center gap-1.5 font-medium hover:underline"
										href={`/orders/${row.publicReference}`}
									>
										{row.publicReference}
										{row.needsRecovery ? (
											<TriangleAlert
												aria-label="Needs recovery"
												className="size-3.5 text-amber-500"
											/>
										) : null}
									</Link>
								</TableCell>
								<TableCell>
									<StatusDot status={row.status} />
								</TableCell>
								<TableCell className="text-muted-foreground">
									{row.contactName ?? row.contactEmail ?? "—"}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatMoneyMinor(row.totalMinor, row.currency)}
								</TableCell>
								<TableCell className="text-right text-muted-foreground tabular-nums">
									{formatMoneyMinor(row.amountPaidMinor, row.currency)}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatDateTime(row.createdAt)}
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
						href={pageHref({ page: page - 1, q: query, status })}
					>
						Previous
					</Link>
				</Button>
				<Button asChild disabled={!hasNext} size="sm" variant="ghost">
					<Link
						aria-disabled={!hasNext}
						className={hasNext ? "" : "pointer-events-none opacity-40"}
						href={pageHref({ page: page + 1, q: query, status })}
					>
						Next
					</Link>
				</Button>
			</div>
		</div>
	);
}
