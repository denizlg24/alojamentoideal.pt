import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusDot } from "@/components/status-dot";
import {
	loadConnectedAccountTransferQueue,
	loadGuestSubmissionQueue,
	loadMissingConversationQueue,
	loadOwedReversalQueue,
	loadPendingRefundQueue,
	loadReservationHoldQueue,
} from "@/lib/api/reconciliations";
import { formatMoneyMinor, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Reconciliations" };

export const dynamic = "force-dynamic";

function OrderLink({ reference }: { reference: string }) {
	return (
		<Link className="font-medium hover:underline" href={`/orders/${reference}`}>
			{reference}
		</Link>
	);
}

function QueueSection({
	children,
	count,
	description,
	shown,
	title,
}: {
	children: ReactNode;
	count: number;
	description: string;
	shown: number;
	title: string;
}) {
	return (
		<section className="border-border/60 border-t py-6 first:border-t-0">
			<div className="flex items-baseline justify-between gap-4">
				<h2 className="font-medium text-sm uppercase tracking-wide">{title}</h2>
				<span className="font-medium text-sm tabular-nums">
					{count === 0 ? "clear" : count}
				</span>
			</div>
			<p className="mt-1 max-w-3xl text-muted-foreground text-xs">
				{description}
			</p>
			{count === 0 ? (
				<p className="mt-4 text-muted-foreground text-sm">Nothing waiting.</p>
			) : (
				children
			)}
			{count > shown ? (
				<p className="mt-2 text-muted-foreground text-xs">
					Showing the oldest {shown} of {count}.
				</p>
			) : null}
		</section>
	);
}

export default async function ReconciliationsPage() {
	const [holds, transfers, refunds, reversals, conversations, guestJobs] =
		await Promise.all([
			loadReservationHoldQueue(),
			loadConnectedAccountTransferQueue(),
			loadPendingRefundQueue(),
			loadOwedReversalQueue(),
			loadMissingConversationQueue(),
			loadGuestSubmissionQueue(),
		]);

	const overview = [
		{ count: holds.count, label: "Reservation holds" },
		{ count: transfers.count, label: "Listing transfers" },
		{ count: refunds.count, label: "Pending refunds" },
		{ count: reversals.count, label: "Owed reversals" },
		{ count: conversations.count, label: "Missing conversations" },
		{ count: guestJobs.count, label: "Guest submissions" },
	];

	return (
		<div className="mx-auto max-w-7xl">
			<h1 className="font-display font-semibold text-xl tracking-tight">
				Reconciliations
			</h1>
			<p className="mt-1 max-w-3xl text-muted-foreground text-sm">
				In-flight work the reconciler crons still have to settle. Every queue
				drains on its own; rows listed here need no action unless they sit for
				days or are flagged for recovery.
			</p>

			<dl className="mt-6 grid gap-x-6 gap-y-4 border-border/60 border-y py-5 sm:grid-cols-3 lg:grid-cols-6">
				{overview.map((entry) => (
					<div key={entry.label}>
						<dt className="text-muted-foreground text-xs uppercase tracking-wide">
							{entry.label}
						</dt>
						<dd className="mt-1 font-medium text-lg tabular-nums">
							{entry.count}
						</dd>
					</div>
				))}
			</dl>

			<div className="mt-6">
				<QueueSection
					count={holds.count}
					description="Provider holds the reservation saga is still resolving: paid orders awaiting confirmation, unsettled holds being nudged, and released holds retrying. Drained by the reservations cron."
					shown={holds.rows.length}
					title="Reservation holds"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead>Provider</TableHead>
								<TableHead>Hold</TableHead>
								<TableHead>Order status</TableHead>
								<TableHead className="text-right">Attempts</TableHead>
								<TableHead>Next attempt</TableHead>
								<TableHead>Last error</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{holds.rows.map((row) => (
								<TableRow
									key={`${row.orderReference}:${row.providerReservationId ?? row.nextAttemptAt?.toISOString() ?? row.normalizedStatus}`}
								>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell>{row.provider}</TableCell>
									<TableCell>
										<StatusDot status={row.normalizedStatus} />
										{row.needsRecovery ? (
											<span className="mt-0.5 block text-amber-700 text-xs dark:text-amber-500">
												needs recovery
											</span>
										) : null}
									</TableCell>
									<TableCell>
										<StatusDot status={row.orderStatus} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.attemptCount}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.nextAttemptAt)}
									</TableCell>
									<TableCell className="max-w-56 truncate text-muted-foreground text-xs">
										{row.lastErrorCode ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>

				<QueueSection
					count={transfers.count}
					description="Per-listing Stripe Connect transfers awaiting creation or retry. Stable idempotency keys make every retry safe after a timeout or process crash. Drained by the reservations cron."
					shown={transfers.rows.length}
					title="Listing connected-account transfers"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead>Destination</TableHead>
								<TableHead className="text-right">Amount</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Attempts</TableHead>
								<TableHead>Next attempt</TableHead>
								<TableHead>Last error</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{transfers.rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell className="font-mono text-xs">
										{row.destinationAccountId}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoneyMinor(row.amountMinor, row.currency)}
									</TableCell>
									<TableCell>
										<StatusDot status={row.status} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.attemptCount}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.nextAttemptAt)}
									</TableCell>
									<TableCell className="max-w-72 truncate text-muted-foreground text-xs">
										{row.lastErrorMessage ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>

				<QueueSection
					count={refunds.count}
					description="Refund ledger rows still pending: the amount is reserved on the order but the Stripe refund has not been confirmed. Resumed by the refunds cron with the stored idempotency key."
					shown={refunds.rows.length}
					title="Pending refunds"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead className="text-right">Amount</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Requested</TableHead>
								<TableHead>Last error</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{refunds.rows.map((row) => (
								<TableRow
									key={`${row.orderReference}:${row.createdAt.toISOString()}`}
								>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoneyMinor(row.amountMinor, row.currency)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{row.reason.replaceAll("_", " ")}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.createdAt)}
									</TableCell>
									<TableCell className="max-w-72 truncate text-muted-foreground text-xs">
										{row.lastErrorMessage ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>

				<QueueSection
					count={reversals.count}
					description="Refunds that succeeded but whose Detours or listing transfer reversal failed. The guest was repaid while funds are still on a connected account. Retried by the refunds cron."
					shown={reversals.rows.length}
					title="Owed transfer reversals"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead className="text-right">Refund</TableHead>
								<TableHead>Refunded</TableHead>
								<TableHead>Reversal error</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{reversals.rows.map((row) => (
								<TableRow
									key={`${row.orderReference}:${row.completedAt?.toISOString() ?? row.amountMinor}`}
								>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoneyMinor(row.amountMinor, row.currency)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.completedAt)}
									</TableCell>
									<TableCell className="max-w-96 truncate text-muted-foreground text-xs">
										{row.lastErrorMessage ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>

				<QueueSection
					count={conversations.count}
					description="Confirmed Hostify bookings without a provisioned guest conversation. Provisioned by the conversations cron; Bokun bookings use the order-level internal thread instead."
					shown={conversations.rows.length}
					title="Missing conversations"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead>Provider</TableHead>
								<TableHead>Reservation</TableHead>
								<TableHead>Ordered</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{conversations.rows.map((row) => (
								<TableRow
									key={`${row.orderReference}:${row.providerReservationId ?? row.orderCreatedAt.toISOString()}`}
								>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell>{row.provider}</TableCell>
									<TableCell className="text-muted-foreground text-xs">
										{row.providerReservationId ?? "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.orderCreatedAt)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>

				<QueueSection
					count={guestJobs.count}
					description="Guest data submission jobs the sweep still has to deliver, including exhausted failures awaiting manual resubmission from the order page. Drained by the guest submissions cron."
					shown={guestJobs.rows.length}
					title="Guest submissions"
				>
					<Table className="mt-4">
						<TableHeader>
							<TableRow>
								<TableHead>Order</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Attempts</TableHead>
								<TableHead>Next run</TableHead>
								<TableHead>Error</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{guestJobs.rows.map((row) => (
								<TableRow
									key={`${row.orderReference}:${row.status}:${row.nextRunAt?.toISOString() ?? row.attemptCount}`}
								>
									<TableCell>
										<OrderLink reference={row.orderReference} />
									</TableCell>
									<TableCell>
										<StatusDot status={row.status} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.attemptCount}/{row.maxAttempts}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatRelative(row.nextRunAt)}
									</TableCell>
									<TableCell className="max-w-72 truncate text-muted-foreground text-xs">
										{row.redactedErrorText ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueueSection>
			</div>
		</div>
	);
}
