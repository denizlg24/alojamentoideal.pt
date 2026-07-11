import {
	type ConversationMessageDto,
	type ConversationSummary,
	conversationChannelName,
	isChatReadyConversation,
	type OrderDetailItem,
} from "@workspace/core/commerce";
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
import { buildRefundPolicySuggestions } from "@/lib/orders/refund-policy";
import { ConversationPanel } from "./conversation-panel";
import { GuestEditDialog } from "./guest-edit-dialog";
import { InvoiceActions } from "./invoice-actions";
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

function primaryConversation(
	conversations: ConversationSummary[],
): ConversationSummary | null {
	const live = conversations.find(isChatReadyConversation);
	return live ?? conversations[0] ?? null;
}

function itemTypeLabel(type: string): string {
	if (type === "accommodation") {
		return "Home";
	}
	if (type === "activity") {
		return "Activity";
	}
	return type;
}

function pluralize(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function itemMeta(item: OrderDetailItem): string {
	const parts = [itemTypeLabel(item.type)];
	if (item.type === "accommodation" && item.checkIn && item.checkOut) {
		parts.push(`${formatDate(item.checkIn)} → ${formatDate(item.checkOut)}`);
		if (item.guests) {
			parts.push(pluralize(item.guests, "guest", "guests"));
		}
		if (item.nights) {
			parts.push(pluralize(item.nights, "night", "nights"));
		}
	}
	if (item.type === "activity") {
		if (item.activityDate) {
			parts.push(formatDate(item.activityDate));
		}
		if (item.totalParticipants) {
			parts.push(
				pluralize(item.totalParticipants, "participant", "participants"),
			);
		}
	}
	return parts.join(" · ");
}

function ActivityDetails({ item }: { item: OrderDetailItem }) {
	if (item.type !== "activity") {
		return null;
	}

	return (
		<dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
			<DefinitionRow
				label="Activity date"
				value={
					item.activityDate ? formatDate(item.activityDate) : "Not available"
				}
			/>
			<DefinitionRow
				label="Participants"
				value={item.totalParticipants ?? "Not available"}
			/>
			<DefinitionRow
				label="Booking code"
				value={item.activity?.productConfirmationCode ?? "Not available"}
			/>
			<DefinitionRow
				label="Bokun activity"
				value={item.activity?.bokunActivityId ?? "Not available"}
			/>
			<DefinitionRow
				label="Start time"
				value={item.activity?.startTimeId ?? "Not available"}
			/>
			<DefinitionRow
				label="Pickup"
				value={item.activity?.pickupPlaceId ?? "Not available"}
			/>
			<DefinitionRow
				label="Dropoff"
				value={item.activity?.dropoffPlaceId ?? "Not available"}
			/>
			<DefinitionRow
				label="Room"
				value={item.activity?.roomNumber ?? "Not available"}
			/>
		</dl>
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
	const service = await commerceService();
	const invoicing = invoicingService();
	const [detail, invoices, refunds] = await Promise.all([
		service.readOrderDetail(access),
		invoicing.listOrderInvoices(row.publicReference),
		orderRefundService().listOrderRefunds(row.id),
	]);

	const accommodationBookingIds = detail.items
		.filter((item) => item.type === "accommodation")
		.map((item) => item.providerBooking?.id)
		.filter((id): id is string => typeof id === "string");
	const guestLists = await Promise.all(
		accommodationBookingIds.map((bookingId) =>
			service.readBookingGuests(access, bookingId),
		),
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
	// Policy suggestions hit Bokun live; only pay that cost when the refund
	// dialog can actually render.
	const policySuggestions =
		row.amountPaidMinor > 0 && refundableMinor > 0
			? await buildRefundPolicySuggestions(detail)
			: [];
	const policySuggestionByItem = new Map(
		policySuggestions.map((suggestion) => [suggestion.itemId, suggestion]),
	);
	const refundItems = detail.items.map((item) => ({
		amountMinor: item.pricing?.totalMinor ?? null,
		id: item.id,
		policyLabel: policySuggestionByItem.get(item.id)?.label ?? null,
		policySuggestedAmountMinor:
			policySuggestionByItem.get(item.id)?.suggestedAmountMinor ?? null,
		title: item.title,
	}));
	const itemTitleById = new Map(
		detail.items.map((item) => [item.id, item.title]),
	);
	const invoicingIsEnabled = await invoicingEnabled();
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
	const conversation = primaryConversation(detail.conversations);
	const realtimeConfigured = Boolean(
		process.env.NEXT_PUBLIC_PUSHER_KEY &&
			process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
	);
	const channelName =
		conversation && realtimeConfigured
			? conversationChannelName(row.id, conversation.id)
			: null;
	let initialMessages: ConversationMessageDto[] = [];
	let messagesLoadError = false;
	if (conversation) {
		try {
			initialMessages = await service.readConversationMessages(
				access,
				conversation.id,
				{ limit: 100 },
			);
		} catch (error) {
			console.error("Failed to load admin order conversation messages", error);
			messagesLoadError = true;
		}
	}

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
			{detail.invoiceRequest?.requestedAt ? (
				<div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
					<div className="flex items-center justify-between gap-3">
						<span className="font-medium">Invoice requested</span>
						<span className="rounded-full bg-amber-200 px-2 py-0.5 text-amber-900 text-xs dark:bg-amber-900 dark:text-amber-100">
							{detail.invoiceRequest.fulfilledAt ? "Issued" : "Pending"}
						</span>
					</div>
					{contact ? (
						<p className="mt-1 text-muted-foreground">
							Fiscal details:{" "}
							{contact.isCompany && contact.companyName
								? contact.companyName
								: contact.name}{" "}
							· {contact.taxNumber ?? "No tax number"} ·{" "}
							{[
								contact.billingAddress.line1,
								contact.billingAddress.postalCode,
								contact.billingAddress.city,
								contact.billingAddress.country,
							]
								.filter(Boolean)
								.join(", ")}
						</p>
					) : null}
				</div>
			) : null}

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

			<ConversationPanel
				channelName={channelName}
				conversationId={conversation?.id ?? null}
				initialMessages={initialMessages}
				messagesLoadError={messagesLoadError}
				reference={row.publicReference}
			/>

			<section className="mt-10">
				<h2 className="font-medium text-sm">Items</h2>
				<div className="mt-3 divide-y divide-border/60 border-border/60 border-t border-b">
					{detail.items.map((item) => {
						const booking = item.providerBooking;
						const isAccommodation = item.type === "accommodation";
						const guests = booking ? guestsByBooking.get(booking.id) : null;
						const invoiceDraft = invoiceDraftById.get(item.id) ?? null;
						return (
							<div className="py-6" key={item.id}>
								<div className="flex items-start justify-between gap-4">
									<div>
										<p className="font-medium text-sm">{item.title}</p>
										<p className="mt-0.5 text-muted-foreground text-sm">
											{itemMeta(item)}
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

								<ActivityDetails item={item} />

								{isAccommodation && booking && guests && guests.length > 0 ? (
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

								{isAccommodation && booking ? (
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
											? (itemTitleById.get(refund.orderItemId) ?? "Item")
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
										<InvoiceActions
											invoice={invoice}
											reference={row.publicReference}
										/>
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
