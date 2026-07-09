import { CalendarX } from "lucide-react";

/**
 * Guest-facing cancellation terms for stays. These mirror the hard rules the
 * refund tooling applies (core `stayRefundPercent`): a 48 hour grace window
 * after booking, a 50% band down to 7 days before check-in, nothing after.
 */
const POLICY_LINES = [
	"Full refund if you cancel within 48 hours of booking and check-in is at least 14 days away.",
	"50% refund if you cancel 7 or more days before check-in.",
	"No refund for cancellations less than 7 days before check-in.",
];

export function ListingCancellationPolicy() {
	return (
		<section className="flex flex-col gap-4">
			<h2 className="flex items-center gap-2 font-heading font-semibold text-2xl">
				<CalendarX className="size-5" />
				Cancellation policy
			</h2>
			<ul className="flex flex-col gap-1.5 text-muted-foreground text-sm">
				{POLICY_LINES.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
		</section>
	);
}
