import { Button } from "@workspace/ui/components/button";
import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

const REASON_COPY = {
	full: {
		body: "Every guest spot for this booking has already been filled, so this invite can no longer be used. Ask the person who booked the stay if you should be on it.",
		title: "This booking is full",
	},
	invalid: {
		body: "This link may have expired or already been used. If someone shared this booking with you, ask them to send a fresh invite. If it's your booking, open it from the confirmation email.",
		title: "We couldn't open this booking",
	},
} satisfies Record<string, { body: string; title: string }>;

export function OrderAccessDenied({ reason = "invalid" }: { reason?: string }) {
	const copy = reason === "full" ? REASON_COPY.full : REASON_COPY.invalid;

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="grid flex-1 place-items-center px-4 pt-24 pb-16">
				<div className="flex max-w-md flex-col items-center gap-4 text-center">
					<LockKeyhole className="size-12 text-muted-foreground" />
					<h1 className="font-heading font-semibold text-2xl">{copy.title}</h1>
					<p className="text-muted-foreground text-sm leading-relaxed">
						{copy.body}
					</p>
					<Button asChild>
						<Link href="/homes">Browse homes</Link>
					</Button>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
