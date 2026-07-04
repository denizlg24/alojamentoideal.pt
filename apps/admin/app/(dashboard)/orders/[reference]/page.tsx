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
import { notFound } from "next/navigation";
import { StatusDot } from "@/components/status-dot";
import {
	adminOrderAccess,
	commerceService,
	loadAdminOrder,
	orderRefundService,
} from "@/lib/api/commerce";
import { invoicingEnabled, invoicingService } from "@/lib/api/invoicing";
import { formatDate, formatDateTime, formatMoneyMinor } from "@/lib/format";
import { GuestEditDialog } from "./guest-edit-dialog";
import { InvoicePanel } from "./invoice-panel";
import { OrderActions } from "./order-actions";
import { RefundPanel } from "./refund-panel";
import { ReservationPanel } from "./reservation-panel";

interface OrderDetailPageProps {
	params: Promise<{ reference: string }>;
}

export async function generateMetadata({
	params,
}: OrderDetailPageProps): Promise<Metadata> {
	const { reference } = await params;
	return { title: `Order ${reference.toUpperCase()}` };
}

function DefinitionRow({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div>
			<dt className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</dt>
			<dd className="mt-0.5 text-sm">{value}</dd>
		</div>
	);
}

export default async function OrderDetailPage({
	params,
}: OrderDetailPageProps) {
	const { reference } = await params;
	const row = await loadAdminOrder(reference);
	if (!row) {
		notFound();
	}

	const access = adminOrderAccess(row);
	const service = commerceService();
	const invoicing = invoicingService();
	const [detail, invoices, refunds] = await Promise.all([
		service.readOrderDetail(access),
		invoicing.listOrderInvoices(row.publicReference),
		orderRefundService().listOrderRefunds(row.id),
	]);

	const bookingIds = detail.items
		.map((item) => item.providerBooking?.id)
		.filter((id): id is string => typeof id === "string");
	const guestLists = await Promise.all(
		bookingIds.map((bookingId) => service.readBookingGuests(access, bookingId)),
	);
	const guestsByBooking = new Map(
		guestLists.map((list) => [list.bookingId, list.guests]),
	);

	const pricing = detail.pricing;
	const contact = detail.contact;
	const currency = pricing?.currency ?? "EUR";
	const refundableMinor = Math.max(
		0,
		row.amountPaidMinor - row.amountRefundedMinor,
	);
	const refundItems = detail.items.map((item) => ({
		amountMinor: item.pricing?.totalMinor ?? null,
		id: item.id,
		title: item.title,
	}));
	const itemTitleById = new Map(
		detail.items.map((item) => [item.id, item.title]),
	);
	const invoicingIsEnabled = invoicingEnabled();
	const activeInvoiceItemIds = new Set(
		invoices
			.filter(
				(invoice) =>
					invoice.kind === "invoice" &&
					(invoice.status === "draft" || invoice.status === "issued"),
			)
			.map((invoice) => invoice.orderItemId),
	);
	const invoiceableItems =
		row.status === "confirmed"
			? detail.items.filter(
					(item) =>
						item.type === "accommodation" && !activeInvoiceItemIds.has(item.id),
				)
			: [];
	const invoiceDraftById = new Map(
		await Promise.all(
			invoiceableItems.map(async (item) => {
				try {
					const draft = await invoicing.buildOrderItemInvoiceDraft({
						orderItemId: item.id,
						orderReference: row.publicReference,
					});
					return [item.id, draft] as const;
				} catch {
					return [item.id, null] as const;
				}
			}),
		),
	);

	return (
		<div className="mx-auto max-w-4xl">
			<Link
				className="text-muted-foreground text-sm hover:text-foreground"
				href="/orders"
			>
				← Orders
			</Link>

			<div className="mt-3 flex items-start justify-between gap-6">
				<h1 className="font-display font-semibold text-xl tracking-tight">
					{row.publicReference}
				</h1>
				<OrderActions
					amountPaidMinor={row.amountPaidMinor}
					amountRefundedMinor={row.amountRefundedMinor}
					reference={row.publicReference}
					status={row.status}
				/>
			</div>

			<dl className="mt-6 grid grid-cols-4 gap-x-6 gap-y-4">
				<DefinitionRow
					label="Created"
					value={formatDateTime(detail.createdAt)}
				/>
				<DefinitionRow
					label="Guest"
					value={
						contact ? (
							<>
								{contact.name}
								<span className="block text-muted-foreground">
									{contact.email}
								</span>
							</>
						) : (
							"—"
						)
					}
				/>
				<DefinitionRow label="Phone" value={contact?.phoneE164 ?? "—"} />
				<DefinitionRow
					label="Payment"
					value={
						detail.paymentMethod
							? `${detail.paymentMethod.brand ?? detail.paymentMethod.type}${
									detail.paymentMethod.last4
										? ` ···· ${detail.paymentMethod.last4}`
										: ""
								}`
							: "—"
					}
				/>
				{pricing ? (
					<>
						<DefinitionRow
							label="Total"
							value={formatMoneyMinor(pricing.totalMinor, pricing.currency)}
						/>
						<DefinitionRow
							label="Paid"
							value={formatMoneyMinor(
								pricing.amountPaidMinor,
								pricing.currency,
							)}
						/>
						<DefinitionRow
							label="Refunded"
							value={formatMoneyMinor(
								pricing.amountRefundedMinor,
								pricing.currency,
							)}
						/>
						<DefinitionRow
							label="Guest data"
							value={`${detail.guestProgress.verified + detail.guestProgress.pending}/${detail.guestProgress.total} provided`}
						/>
					</>
				) : null}
			</dl>

			<section className="mt-10">
				<h2 className="font-medium text-sm">Items</h2>
				<div className="mt-3 divide-y divide-border/60 border-border/60 border-t border-b">
					{detail.items.map((item) => {
						const booking = item.providerBooking;
						const guests = booking ? guestsByBooking.get(booking.id) : null;
						const invoiceDraft = invoiceDraftById.get(item.id) ?? null;
						return (
							<div className="py-6" key={item.id}>
								<div className="flex items-start justify-between gap-4">
									<div>
										<p className="font-medium text-sm">{item.title}</p>
										<p className="mt-0.5 text-muted-foreground text-sm">
											{item.checkIn && item.checkOut
												? `${formatDate(item.checkIn)} → ${formatDate(item.checkOut)}`
												: item.type}
											{item.guests ? ` · ${item.guests} guests` : ""}
											{item.nights ? ` · ${item.nights} nights` : ""}
										</p>
									</div>
									<div className="flex items-center gap-3">
										{booking?.needsRecovery ? (
											<span className="inline-flex items-center gap-1 text-amber-600 text-xs dark:text-amber-500">
												<TriangleAlert className="size-3.5" />
												needs recovery
											</span>
										) : null}
										{booking ? <StatusDot status={booking.status} /> : null}
										{item.pricing ? (
											<span className="text-sm tabular-nums">
												{formatMoneyMinor(
													item.pricing.totalMinor,
													item.pricing.currency,
												)}
											</span>
										) : null}
									</div>
								</div>

								{booking && guests && guests.length > 0 ? (
									<Table className="mt-3">
										<TableHeader>
											<TableRow>
												<TableHead className="w-10">#</TableHead>
												<TableHead>Name</TableHead>
												<TableHead>Identity</TableHead>
												<TableHead>Submitted</TableHead>
												<TableHead className="w-16" />
											</TableRow>
										</TableHeader>
										<TableBody>
											{guests.map((guest) => (
												<TableRow key={guest.id}>
													<TableCell className="text-muted-foreground">
														{guest.position + 1}
													</TableCell>
													<TableCell>
														{guest.fields.firstName || guest.fields.lastName
															? `${guest.fields.firstName ?? ""} ${guest.fields.lastName ?? ""}`.trim()
															: "—"}
													</TableCell>
													<TableCell>
														<StatusDot status={guest.identityStatus} />
													</TableCell>
													<TableCell className="text-muted-foreground">
														{guest.submittedAt
															? formatDateTime(guest.submittedAt)
															: "—"}
													</TableCell>
													<TableCell className="text-right">
														<GuestEditDialog
															bookingId={booking.id}
															guest={guest}
															reference={row.publicReference}
														/>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : null}

								{booking ? (
									<ReservationPanel
										bookingId={booking.id}
										checkIn={item.checkIn}
										checkOut={item.checkOut}
										currentStatus={booking.status}
										guests={item.guests}
										reference={row.publicReference}
									/>
								) : null}

								{invoiceDraft ? (
									<InvoicePanel
										draft={invoiceDraft}
										invoicingEnabled={invoicingIsEnabled}
										reference={row.publicReference}
									/>
								) : null}
							</div>
						);
					})}
				</div>
			</section>

			<section className="mt-10">
				<div className="flex items-center justify-between gap-4">
					<h2 className="font-medium text-sm">Payments &amp; refunds</h2>
					{row.amountPaidMinor > 0 && refundableMinor > 0 ? (
						<RefundPanel
							currency={currency}
							items={refundItems}
							reference={row.publicReference}
							refundableMinor={refundableMinor}
						/>
					) : null}
				</div>
				{refunds.length === 0 ? (
					<p className="mt-3 text-muted-foreground text-sm">
						{row.amountPaidMinor > 0
							? `${formatMoneyMinor(refundableMinor, currency)} refundable. No refunds issued yet.`
							: "No payment captured for this order."}
					</p>
				) : (
					<Table className="mt-3">
						<TableHeader>
							<TableRow>
								<TableHead className="text-right">Amount</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Attributed to</TableHead>
								<TableHead>Issued</TableHead>
								<TableHead>Stripe id</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{refunds.map((refund) => (
								<TableRow key={refund.id}>
									<TableCell className="text-right tabular-nums">
										{formatMoneyMinor(refund.amountMinor, refund.currency)}
									</TableCell>
									<TableCell>
										<StatusDot status={refund.status} />
									</TableCell>
									<TableCell className="text-muted-foreground">
										{refund.reason.replace(/_/g, " ")}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{refund.orderItemId
											? (itemTitleById.get(refund.orderItemId) ?? "Reservation")
											: "Whole order"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDateTime(refund.createdAt)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{refund.stripeRefundId ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</section>

			<section className="mt-10">
				<h2 className="font-medium text-sm">Fiscal documents</h2>
				{invoices.length === 0 ? (
					<p className="mt-3 text-muted-foreground text-sm">
						No invoices or credit notes recorded for this order.
					</p>
				) : (
					<Table className="mt-3">
						<TableHeader>
							<TableRow>
								<TableHead>Kind</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Hostkit id</TableHead>
								<TableHead className="text-right">Total</TableHead>
								<TableHead>Issued</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{invoices.map((invoice) => (
								<TableRow key={invoice.id}>
									<TableCell>{invoice.kind}</TableCell>
									<TableCell>
										<StatusDot status={invoice.status} />
									</TableCell>
									<TableCell className="text-muted-foreground">
										{invoice.hostkitInvoiceId ?? "—"}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoneyMinor(invoice.totalMinor, invoice.currency)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{invoice.issuedAt ? formatDateTime(invoice.issuedAt) : "—"}
									</TableCell>
									<TableCell className="text-right">
										{invoice.documentUrl ? (
											<a
												className="text-sm underline underline-offset-2"
												href={invoice.documentUrl}
												rel="noreferrer"
												target="_blank"
											>
												Document
											</a>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</section>
		</div>
	);
}
