import type { OrderDetail } from "@workspace/core/commerce";
import { ChevronRight, MessageCircle, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatMinor, formatStayRangeLong } from "@/lib/checkout/format";

function statusBody(detail: OrderDetail): string {
	switch (detail.provisioningSubState) {
		case "confirmed":
			return "Your stay is confirmed. We've emailed your booking details and you can manage everything here.";
		case "paid-confirming":
			return "Payment received. We're finalizing your booking and will confirm by email shortly.";
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
		<div className="flex items-baseline justify-between gap-4 py-2">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="text-right font-medium text-sm">{value}</dd>
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
			<span className="flex flex-col">
				<span className="font-medium text-sm">{title}</span>
				<span className="text-muted-foreground text-xs">{subtitle}</span>
			</span>
			<ChevronRight className="ml-auto size-4 text-muted-foreground" />
		</Link>
	);
}

function conversationSubtitle(detail: OrderDetail): string {
	switch (detail.conversationAvailability) {
		case "available":
			return "Message the Alojamento Ideal team about your stay";
		case "pending":
			return "Chat opens once your booking is confirmed";
		default:
			return "Available once your booking is confirmed";
	}
}

function guestsSubtitle(detail: OrderDetail): string {
	const { total, verified } = detail.guestProgress;
	if (total === 0) {
		return "Add guest registration details";
	}
	if (verified >= total) {
		return "All guest details are complete";
	}
	return `${verified} of ${total} guests completed`;
}

export function OrderOverview({ detail }: { detail: OrderDetail }) {
	const root = `/order/${encodeURIComponent(detail.reference)}`;
	const body = statusBody(detail);
	const pricing = detail.pricing;

	return (
		<div className="flex flex-col gap-8">
			{body && <p className="text-sm leading-relaxed">{body}</p>}

			<section className="flex flex-col gap-2">
				<h2 className="font-heading font-medium text-base">Your stay</h2>
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
							</div>
						</div>
					))}
				</dl>
			</section>

			{pricing && (
				<section className="flex flex-col gap-2">
					<h2 className="font-heading font-medium text-base">Price</h2>
					<dl>
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
				<LinkRow
					href={`${root}/messages`}
					icon={<MessageCircle className="size-4" />}
					subtitle={conversationSubtitle(detail)}
					title="Messages"
				/>
				<LinkRow
					href={`${root}/guests`}
					icon={<Users className="size-4" />}
					subtitle={guestsSubtitle(detail)}
					title="Guest registration"
				/>
				{detail.role === "owner" && (
					<LinkRow
						href={`${root}/people`}
						icon={<UserPlus className="size-4" />}
						subtitle="Invite others to join this booking"
						title="People"
					/>
				)}
			</section>
		</div>
	);
}
