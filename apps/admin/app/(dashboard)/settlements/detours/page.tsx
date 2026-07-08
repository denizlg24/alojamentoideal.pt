import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import { formatDate, formatDateTime, formatMoneyMinor } from "@/lib/format";
import { getDetoursSettlementReport } from "@/lib/reporting/detours-settlements";
import {
	type DetoursSettlementFeeStatus,
	parseDetoursSettlementPeriod,
} from "@/lib/reporting/detours-settlements-core";

export const metadata: Metadata = { title: "Detours Settlement" };

interface DetoursSettlementPageProps {
	searchParams: Promise<{ from?: string; to?: string }>;
}

const FEE_STATUS_LABELS: Record<DetoursSettlementFeeStatus, string> = {
	available: "Available",
	currency_mismatch: "Currency mismatch",
	missing_payment_intent: "Missing PaymentIntent",
	missing_stripe_fee: "Missing Stripe fee",
	stripe_error: "Stripe error",
	stripe_unavailable: "Stripe unavailable",
};

function exportHref(format: "csv" | "pdf", from: string, to: string): string {
	const search = new URLSearchParams({ format, from, to });
	return `/api/admin/settlements/detours?${search.toString()}`;
}

function moneyOrUnavailable(
	amountMinor: number | null,
	currency: string,
): string {
	return amountMinor === null
		? "Not available"
		: formatMoneyMinor(amountMinor, currency);
}

export default async function DetoursSettlementPage({
	searchParams,
}: DetoursSettlementPageProps) {
	const params = await searchParams;
	const period = parseDetoursSettlementPeriod({
		from: params.from,
		to: params.to,
	});
	const report = await getDetoursSettlementReport(period);

	return (
		<div className="mx-auto max-w-7xl">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Detours settlement
					</h1>
					<p className="mt-1 max-w-3xl text-muted-foreground text-sm">
						Activity gross transferred to the Detours Stripe connected account,
						with Stripe fees paid by Alojamento Ideal for later settlement.
					</p>
				</div>
				<div className="flex flex-col gap-3">
					<form
						action="/settlements/detours"
						className="flex flex-col gap-2 sm:flex-row sm:items-end"
					>
						<label
							className="grid gap-1 text-muted-foreground text-xs"
							htmlFor="settlement-from"
						>
							From
							<Input
								className="w-full sm:w-40"
								defaultValue={period.from}
								id="settlement-from"
								name="from"
								type="date"
							/>
						</label>
						<label
							className="grid gap-1 text-muted-foreground text-xs"
							htmlFor="settlement-to"
						>
							To
							<Input
								className="w-full sm:w-40"
								defaultValue={period.to}
								id="settlement-to"
								name="to"
								type="date"
							/>
						</label>
						<div className="flex gap-2">
							<Button size="sm" type="submit">
								<FileText aria-hidden />
								Apply
							</Button>
							<Button asChild size="sm" variant="ghost">
								<Link href="/settlements/detours">Reset</Link>
							</Button>
						</div>
					</form>
					<div className="flex gap-2 sm:justify-end">
						<Button asChild size="sm" variant="outline">
							<Link href={exportHref("csv", period.from, period.to)}>
								<FileSpreadsheet aria-hidden />
								CSV
							</Link>
						</Button>
						<Button asChild size="sm" variant="outline">
							<Link href={exportHref("pdf", period.from, period.to)}>
								<Download aria-hidden />
								PDF
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<div className="mt-6 divide-y divide-border/60 border-border/60 border-y">
				{report.totals.length === 0 ? (
					<p className="py-6 text-muted-foreground text-sm">
						No paid activity orders were found for this period.
					</p>
				) : (
					report.totals.map((total) => (
						<dl
							className="grid gap-x-6 gap-y-4 py-5 sm:grid-cols-2 lg:grid-cols-6"
							key={total.currency}
						>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Gross transferred
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{formatMoneyMinor(
										total.transferredGrossMinor,
										total.currency,
									)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Stripe fees
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{formatMoneyMinor(total.stripeFeeMinor, total.currency)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Net after fees
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{moneyOrUnavailable(total.netMinor, total.currency)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Settlement due
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{formatMoneyMinor(total.settlementDueMinor, total.currency)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Orders
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{total.orderCount}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									Items
								</dt>
								<dd className="mt-1 font-medium text-lg tabular-nums">
									{total.itemCount}
								</dd>
							</div>
						</dl>
					))
				)}
			</div>

			{report.feeDataComplete ? null : (
				<p className="mt-3 text-amber-700 text-sm dark:text-amber-500">
					Stripe fee data is incomplete for one or more rows. Check the fee
					status column before settling with Detours.
				</p>
			)}

			<Table className="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Order</TableHead>
						<TableHead>Activity</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Gross</TableHead>
						<TableHead className="text-right">Stripe fee</TableHead>
						<TableHead className="text-right">Net</TableHead>
						<TableHead>Payment</TableHead>
						<TableHead>Fee status</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{report.rows.length === 0 ? (
						<TableRow>
							<TableCell
								className="py-10 text-center text-muted-foreground"
								colSpan={8}
							>
								No settlement rows match this period.
							</TableCell>
						</TableRow>
					) : (
						report.rows.map((row) => (
							<TableRow key={row.itemId}>
								<TableCell>
									<Link
										className="font-medium hover:underline"
										href={`/orders/${row.orderReference}`}
									>
										{row.orderReference}
									</Link>
									<span className="mt-0.5 block text-muted-foreground text-xs">
										{formatDateTime(row.settlementRecordedAt)}
									</span>
								</TableCell>
								<TableCell>
									<span className="font-medium">{row.activityTitle}</span>
									<span className="mt-0.5 block text-muted-foreground text-xs">
										{formatDate(row.activityDate)}
									</span>
								</TableCell>
								<TableCell>
									<div className="space-y-1">
										<StatusDot status={row.orderStatus} />
										{row.providerBookingStatus ? (
											<div className="text-muted-foreground text-xs">
												Activity: {row.providerBookingStatus}
											</div>
										) : null}
									</div>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatMoneyMinor(row.transferredGrossMinor, row.currency)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{moneyOrUnavailable(row.stripeFeeMinor, row.currency)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{moneyOrUnavailable(row.netMinor, row.currency)}
								</TableCell>
								<TableCell className="max-w-56 text-muted-foreground text-xs">
									<span className="block truncate">
										PI {row.paymentIntentId ?? "Not available"}
									</span>
									<span className="block truncate">
										Charge {row.chargeId ?? "Not available"}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground text-xs">
									{FEE_STATUS_LABELS[row.feeStatus]}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
