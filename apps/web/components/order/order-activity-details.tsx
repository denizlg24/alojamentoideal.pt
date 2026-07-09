import { humanizeToken } from "@workspace/core/activities";
import type { OrderDetail, OrderDetailItem } from "@workspace/core/commerce";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { FileText, ReceiptText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatActivityHtml } from "@/lib/activities/format";
import { formatActivityDateLong } from "@/lib/checkout/format";
import type { OrderActivityView } from "@/lib/order/activity";
import { OrderActivityQuestions } from "./order-activity-questions";

function Field({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-4 py-2">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="break-words text-right font-medium text-sm">{value}</dd>
		</div>
	);
}

function ProseSection({ html, title }: { html: string | null; title: string }) {
	const blocks = formatActivityHtml(html);
	if (blocks.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<h3 className="font-heading font-medium text-base">{title}</h3>
			<div className="flex flex-col gap-2 text-muted-foreground text-sm leading-relaxed">
				{blocks.map((block, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: prose blocks are positional
					<p className="whitespace-pre-line" key={index}>
						{block}
					</p>
				))}
			</div>
		</div>
	);
}

function DocumentLink({
	href,
	icon,
	title,
}: {
	href: string;
	icon: ReactNode;
	title: string;
}) {
	return (
		<a
			className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/60"
			href={href}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
				{icon}
			</span>
			<span className="font-medium text-sm">{title}</span>
		</a>
	);
}

/** Switcher between activity items when the order holds more than one. */
function ActivitySwitcher({
	activityItems,
	currentItemId,
	reference,
}: {
	activityItems: OrderDetailItem[];
	currentItemId: string;
	reference: string;
}) {
	if (activityItems.length < 2) {
		return null;
	}
	const root = `/order/${encodeURIComponent(reference)}`;
	return (
		<div className="flex flex-wrap gap-2">
			{activityItems.map((item) => {
				const active = item.id === currentItemId;
				return (
					<Link
						className={cn(
							"rounded-full border px-3 py-1.5 font-medium text-xs transition-colors",
							active
								? "border-foreground text-foreground"
								: "border-border text-muted-foreground hover:text-foreground",
						)}
						href={`${root}/activity/${encodeURIComponent(item.id)}`}
						key={item.id}
					>
						{item.title}
					</Link>
				);
			})}
		</div>
	);
}

function missingInfoNote(view: OrderActivityView): string | null {
	const completeness = view.questions?.completeness;
	if (!completeness) {
		return null;
	}
	if (completeness.missingRequired > 0) {
		return "Some required information is still missing. Please complete the questions below so the operator can prepare your activity.";
	}
	if (completeness.missingOptional > 0) {
		return "You can add a few optional details below to help the operator prepare your activity.";
	}
	return null;
}

/**
 * Order-hub "Activity" section for one booked activity: live booking facts,
 * pickup and drop-off, the operator's booking questions (editable), ticket and
 * invoice downloads, and the activity's practical information.
 */
export function OrderActivityDetails({
	detail,
	view,
}: {
	detail: OrderDetail;
	view: OrderActivityView;
}) {
	const { experience, item, live, questions } = view;
	const activityItems = detail.items.filter(
		(entry) => entry.type === "activity",
	);
	const confirmed = detail.provisioningSubState === "confirmed";
	const documentsBase = `/api/orders/${encodeURIComponent(detail.reference)}/items/${encodeURIComponent(item.id)}`;
	const note = missingInfoNote(view);

	const hasPickupInfo =
		live !== null &&
		(live.pickupPlaceTitle !== null ||
			live.pickupTime !== null ||
			live.dropoffPlaceTitle !== null);
	const meetsOnLocation = experience?.meetingType === "MEET_ON_LOCATION";

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">Activity details</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Everything about your activity: schedule, meeting point, your booking
					information and documents.
				</p>
			</div>

			<ActivitySwitcher
				activityItems={activityItems}
				currentItemId={item.id}
				reference={detail.reference}
			/>

			<section className="flex flex-col gap-2">
				<h3 className="font-heading font-medium text-base">{item.title}</h3>
				<dl className="divide-y divide-border/60">
					{item.activityDate && (
						<Field
							label="Date"
							value={formatActivityDateLong(item.activityDate)}
						/>
					)}
					{live?.startTime && (
						<Field label="Start time" value={live.startTime} />
					)}
					{item.totalParticipants != null && (
						<Field
							label="Participants"
							value={`${item.totalParticipants} ${
								item.totalParticipants === 1 ? "participant" : "participants"
							}`}
						/>
					)}
					{item.activity?.productConfirmationCode && (
						<Field
							label="Confirmation code"
							value={item.activity.productConfirmationCode}
						/>
					)}
					{live?.status && (
						<Field label="Status" value={humanizeToken(live.status)} />
					)}
				</dl>
			</section>

			{(hasPickupInfo || meetsOnLocation) && (
				<section className="flex flex-col gap-2">
					<h3 className="font-heading font-medium text-base">
						Pickup and meeting point
					</h3>
					{hasPickupInfo ? (
						<dl className="divide-y divide-border/60">
							{live?.pickupPlaceTitle && (
								<Field label="Pickup location" value={live.pickupPlaceTitle} />
							)}
							{live?.pickupPlaceDescription && (
								<Field label="Details" value={live.pickupPlaceDescription} />
							)}
							{live?.pickupPlaceRoomNumber && (
								<Field label="Room number" value={live.pickupPlaceRoomNumber} />
							)}
							{live?.pickupTime && (
								<Field label="Pickup time" value={live.pickupTime} />
							)}
							{live?.dropoffPlaceTitle && (
								<Field
									label="Drop-off location"
									value={live.dropoffPlaceTitle}
								/>
							)}
						</dl>
					) : (
						<p className="text-muted-foreground text-sm leading-relaxed">
							This activity meets on location. Check your ticket for the exact
							meeting point and arrival time.
						</p>
					)}
				</section>
			)}

			{confirmed && item.activity?.productConfirmationCode && (
				<section className="flex flex-col">
					<h3 className="mb-1 font-heading font-medium text-base">Documents</h3>
					<DocumentLink
						href={`${documentsBase}/ticket`}
						icon={<FileText className="size-4" />}
						title="Download ticket (PDF)"
					/>
					<DocumentLink
						href={`${documentsBase}/invoice`}
						icon={<ReceiptText className="size-4" />}
						title="Download invoice (PDF)"
					/>
				</section>
			)}

			{questions && (
				<section className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<h3 className="font-heading font-medium text-base">
							Booking information
						</h3>
						{note && (
							<p className="text-amber-700 text-sm leading-relaxed dark:text-amber-400">
								{note}
							</p>
						)}
					</div>
					<OrderActivityQuestions
						itemId={item.id}
						reference={detail.reference}
						snapshot={questions.snapshot}
					/>
				</section>
			)}

			{experience &&
				(experience.included ||
					experience.excluded ||
					experience.requirements ||
					experience.attention) && (
					<>
						<Separator />
						<section className="flex flex-col gap-4">
							<h3 className="font-heading font-medium text-base">
								Good to know
							</h3>
							<ProseSection
								html={experience.included}
								title="What's included"
							/>
							<ProseSection html={experience.excluded} title="Not included" />
							<ProseSection
								html={experience.requirements}
								title="What to bring"
							/>
							<ProseSection html={experience.attention} title="Important" />
						</section>
					</>
				)}
		</div>
	);
}
