import type { OrderDetail } from "@workspace/core/commerce";
import {
	ChevronRight,
	Compass,
	Home,
	MessageCircle,
	ReceiptText,
	Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
	formatActivityDateLong,
	formatMinor,
	formatStayRangeLong,
} from "@/lib/checkout/format";
import { siteConfig } from "@/lib/site/config";
import { countryName } from "@/lib/site/countries";

/**
 * A paid booking whose confirmation has been retried past the grace window (the
 * provider has not yet accepted the hold). The copy softens to manage
 * expectations without exposing any provider/system detail.
 */
function isConfirmationDelayed(detail: OrderDetail): boolean {
	return (
		detail.provisioningSubState === "paid-confirming" &&
		detail.items.some((item) => item.providerBooking?.needsRecovery)
	);
}

/** Heading for the bookings section, keyed to the mix of item types. */
function bookingsHeading(detail: OrderDetail): string {
	const items = detail.items;
	if (items.length > 0 && items.every((item) => item.type === "activity")) {
		return items.length === 1 ? "Your activity" : "Your activities";
	}
	if (
		items.length > 0 &&
		items.every((item) => item.type === "accommodation")
	) {
		return items.length === 1 ? "Your stay" : "Your stays";
	}
	return "Your bookings";
}

function statusBody(detail: OrderDetail): ReactNode {
	switch (detail.provisioningSubState) {
		case "confirmed":
			return "Your booking is confirmed. We've emailed your booking details and you can manage everything here.";
		case "paid-confirming":
			if (isConfirmationDelayed(detail)) {
				return (
					<>
						This is taking a little longer than usual. No action is needed from
						you. If your booking hasn't been confirmed in the next few days,
						please email us at{" "}
						<a
							className="font-medium underline underline-offset-2"
							href={`mailto:${siteConfig.supportEmail}`}
						>
							{siteConfig.supportEmail}
						</a>
						.
					</>
				);
			}
			return "We're confirming your booking and will email you as soon as it's done.";
		case "held-unpaid":
			return "We're holding your dates while your payment is completed.";
		case "refunded":
			return "This booking was cancelled and refunded in full.";
		case "cancelled":
			return "This booking was cancelled.";
		default:
			return "";
	}
}

function Field({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-4 py-2">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="break-words text-right font-medium text-sm">{value}</dd>
		</div>
	);
}

function LinkRow({
	href,
	icon,
	subtitle,
	title,
}: {
	href: string;
	icon: ReactNode;
	subtitle: string;
	title: string;
}) {
	return (
		<Link
			className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/60"
			href={href}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
				{icon}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="font-medium text-sm">{title}</span>
				<span className="break-words text-muted-foreground text-xs">
					{subtitle}
				</span>
			</span>
			<ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}

function DisabledActionRow({
	icon,
	subtitle,
	title,
}: {
	icon: ReactNode;
	subtitle: string;
	title: string;
}) {
	return (
		<button
			aria-disabled="true"
			className="-mx-2 flex w-[calc(100%+1rem)] cursor-not-allowed items-center gap-3 rounded-xl px-2 py-3 text-left opacity-60"
			disabled
			type="button"
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
				{icon}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="font-medium text-sm">{title}</span>
				<span className="break-words text-muted-foreground text-xs">
					{subtitle}
				</span>
			</span>
			<ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
		</button>
	);
}

function conversationSubtitle(detail: OrderDetail): string {
	switch (detail.conversationAvailability) {
		case "available":
			return "Message the Alojamento Ideal team about your booking";
		case "pending":
			return "Chat opens once your booking is confirmed";
		default:
			return "Available once your booking is confirmed";
	}
}

/**
 * Progress copy for the guest-registration row. `guestProgress` is already
 * scoped to the viewer by `readOrderDetail`: the owner counts every slot in the
 * order, an invited member only the slots bound to them, so the numbers here
 * always match what the guests section shows.
 */
function guestsSubtitle(detail: OrderDetail): string {
	const { total, verified } = detail.guestProgress;
	if (total === 0) {
		return detail.role === "owner"
			? "Add guest registration details"
			: "No guest slot is assigned to you yet";
	}
	if (verified >= total) {
		return "All guest details are complete";
	}
	return `${verified} of ${total} guests completed`;
}

function titleCasePaymentPart(value: string): string {
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map(
			(part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
		)
		.join(" ");
}

function paymentMethodLabel(detail: OrderDetail): string {
	const method = detail.paymentMethod;
	if (!method) {
		return "Not recorded";
	}
	if (method.type === "card") {
		const brand = method.brand ? titleCasePaymentPart(method.brand) : "Card";
		return method.last4 ? `${brand} ending in ${method.last4}` : brand;
	}
	return titleCasePaymentPart(method.type) || "Online payment";
}

function paymentStatusLabel(detail: OrderDetail): string {
	switch (detail.provisioningSubState) {
		case "confirmed":
			return "Paid and confirmed";
		case "paid-confirming":
			return "Paid, confirming booking";
		case "held-unpaid":
			return "Awaiting payment";
		case "refunded":
			return "Refunded";
		case "cancelled":
			return "Cancelled";
		default:
			return detail.bookingStatus;
	}
}

function stringPart(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function formatBillingAddress(
	address: NonNullable<OrderDetail["contact"]>["billingAddress"],
): string {
	const cityLine = [address.postalCode, address.city]
		.map(stringPart)
		.filter((part): part is string => part !== null)
		.join(" ");
	const countryCode = stringPart(address.country);
	const parts = [
		stringPart(address.line1),
		stringPart(address.line2),
		cityLine || null,
		stringPart(address.region),
		countryCode ? countryName(countryCode) : null,
	].filter((part): part is string => part !== null);

	return parts.length > 0 ? parts.join(", ") : "Not provided";
}

function chargeLabel(
	charge: NonNullable<OrderDetail["items"][number]["charges"]>[number],
): string {
	const quantity = Number.parseFloat(charge.quantity);
	if (!Number.isFinite(quantity) || quantity === 1) {
		return charge.name;
	}
	return `${charge.name} x ${quantity.toLocaleString("en", {
		maximumFractionDigits: 2,
	})}`;
}

export function OrderOverview({ detail }: { detail: OrderDetail }) {
	const root = `/order/${encodeURIComponent(detail.reference)}`;
	const body = statusBody(detail);
	const pricing = detail.pricing;
	const hasStays = detail.items.some((item) => item.type === "accommodation");
	const activityItems = detail.items.filter((item) => item.type === "activity");

	return (
		<div className="flex flex-col gap-8">
			{body && <p className="text-sm leading-relaxed">{body}</p>}

			<section className="flex flex-col gap-2">
				<h2 className="font-heading font-medium text-base">
					{bookingsHeading(detail)}
				</h2>
				<dl className="divide-y divide-border/60">
					{detail.items.map((item) => (
						<div className="py-2 first:pt-0" key={item.id}>
							<p className="font-medium text-sm">{item.title}</p>
							<div className="mt-1">
								{item.checkIn && item.checkOut && (
									<Field
										label="Dates"
										value={formatStayRangeLong(item.checkIn, item.checkOut)}
									/>
								)}
								{item.nights && (
									<Field
										label="Nights"
										value={`${item.nights} ${item.nights === 1 ? "night" : "nights"}`}
									/>
								)}
								{item.guests && <Field label="Guests" value={item.guests} />}
								{item.type === "activity" && item.activityDate && (
									<Field
										label="Date"
										value={formatActivityDateLong(item.activityDate)}
									/>
								)}
								{item.type === "activity" && item.totalParticipants != null && (
									<Field
										label="Participants"
										value={`${item.totalParticipants} ${
											item.totalParticipants === 1
												? "participant"
												: "participants"
										}`}
									/>
								)}
							</div>
						</div>
					))}
				</dl>
			</section>

			{pricing && (
				<section className="flex flex-col gap-2">
					<h2 className="font-heading font-medium text-base">Order details</h2>
					<dl className="divide-y divide-border/60">
						<Field label="Payment status" value={paymentStatusLabel(detail)} />
						<Field label="Payment method" value={paymentMethodLabel(detail)} />
					</dl>
				</section>
			)}

			{detail.contact && (
				<section className="flex flex-col gap-2">
					<h2 className="font-heading font-medium text-base">
						Contact details
					</h2>
					<dl className="divide-y divide-border/60">
						<Field label="Name" value={detail.contact.name} />
						<Field label="Email" value={detail.contact.email} />
						<Field label="Phone" value={detail.contact.phoneE164} />
						{detail.contact.isCompany && detail.contact.companyName && (
							<Field label="Company" value={detail.contact.companyName} />
						)}
						{detail.contact.taxNumber && (
							<Field label="Tax number" value={detail.contact.taxNumber} />
						)}
						<Field
							label="Billing address"
							value={formatBillingAddress(detail.contact.billingAddress)}
						/>
					</dl>
				</section>
			)}

			{pricing && (
				<section className="flex flex-col gap-2">
					<h2 className="font-heading font-medium text-base">
						Price breakdown
					</h2>
					<div className="divide-y divide-border/60">
						{detail.items.map((item) =>
							item.charges && item.charges.length > 0 ? (
								<div className="py-2 first:pt-0" key={item.id}>
									<p className="font-medium text-sm">{item.title}</p>
									<dl className="mt-1">
										{item.charges.map((charge) => (
											<Field
												key={`${item.id}-${charge.position}`}
												label={chargeLabel(charge)}
												value={formatMinor(charge.grossMinor, pricing.currency)}
											/>
										))}
									</dl>
								</div>
							) : null,
						)}
					</div>
					<dl className="divide-y divide-border/60 border-border/60 border-t">
						<Field
							label="Subtotal"
							value={formatMinor(pricing.subtotalMinor, pricing.currency)}
						/>
						{pricing.discountMinor > 0 && (
							<Field
								label="Discount"
								value={`-${formatMinor(pricing.discountMinor, pricing.currency)}`}
							/>
						)}
						{pricing.taxMinor > 0 && (
							<Field
								label="Tax"
								value={formatMinor(pricing.taxMinor, pricing.currency)}
							/>
						)}
						<Field
							label="Total"
							value={formatMinor(pricing.totalMinor, pricing.currency)}
						/>
						<Field
							label="Paid"
							value={formatMinor(pricing.amountPaidMinor, pricing.currency)}
						/>
						{pricing.amountRefundedMinor > 0 && (
							<Field
								label="Refunded"
								value={formatMinor(
									pricing.amountRefundedMinor,
									pricing.currency,
								)}
							/>
						)}
					</dl>
				</section>
			)}

			<section className="flex flex-col">
				<h2 className="mb-1 font-heading font-medium text-base">
					Manage your booking
				</h2>
				{detail.role === "owner" && (
					<LinkRow
						href={`${root}/messages`}
						icon={<MessageCircle className="size-4" />}
						subtitle={conversationSubtitle(detail)}
						title="Messages"
					/>
				)}
				{hasStays && (
					<LinkRow
						href={`${root}/stay`}
						icon={<Home className="size-4" />}
						subtitle="Photos, amenities, directions and house guide"
						title="Stay details"
					/>
				)}
				{activityItems.map((item) => (
					<LinkRow
						href={`${root}/activity/${encodeURIComponent(item.id)}`}
						icon={<Compass className="size-4" />}
						key={item.id}
						subtitle="Tickets, meeting point and booking information"
						title={activityItems.length > 1 ? item.title : "Activity details"}
					/>
				))}
				{hasStays && (
					<LinkRow
						href={`${root}/guests`}
						icon={<Users className="size-4" />}
						subtitle={guestsSubtitle(detail)}
						title="Guest registration"
					/>
				)}
				{hasStays && (
					<DisabledActionRow
						icon={<ReceiptText className="size-4" />}
						subtitle="Invoice generation is not available yet"
						title="Generate invoice"
					/>
				)}
			</section>
		</div>
	);
}
