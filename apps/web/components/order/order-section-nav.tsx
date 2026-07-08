"use client";

import { cn } from "@workspace/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Section {
	href: string;
	key: string;
	label: string;
}

/**
 * Horizontal, scrollable section switcher for the order hub. Each section is a
 * nested route, so navigation is real links (deep-linkable, SSR per section);
 * the active tab is derived from the pathname rather than client state.
 */
export function OrderSectionNav({
	activityHref,
	reference,
	showGuests,
	showMessages,
	showStay,
}: {
	/** First activity item's section href; null when the order has none. */
	activityHref: string | null;
	reference: string;
	showGuests: boolean;
	showMessages: boolean;
	showStay: boolean;
}) {
	const pathname = usePathname();
	const root = `/order/${encodeURIComponent(reference)}`;

	const sections: Section[] = [
		{ href: root, key: "overview", label: "Overview" },
	];
	if (showMessages) {
		sections.push({
			href: `${root}/messages`,
			key: "messages",
			label: "Messages",
		});
	}
	if (showStay) {
		sections.push({ href: `${root}/stay`, key: "stay", label: "Stay" });
	}
	if (activityHref) {
		sections.push({ href: activityHref, key: "activity", label: "Activity" });
	}
	if (showGuests) {
		sections.push({ href: `${root}/guests`, key: "guests", label: "Guests" });
	}

	return (
		<nav className="-mb-px flex gap-1 overflow-x-auto border-border/60 border-b">
			{sections.map((section) => {
				const active =
					section.key === "overview"
						? pathname === root
						: section.key === "activity"
							? pathname.startsWith(`${root}/activity/`)
							: pathname === section.href ||
								pathname.startsWith(`${section.href}/`);
				return (
					<Link
						aria-current={active ? "page" : undefined}
						className={cn(
							"whitespace-nowrap border-b-2 px-3 py-3 font-medium text-sm transition-colors",
							active
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						href={section.href}
						key={section.key}
					>
						{section.label}
					</Link>
				);
			})}
		</nav>
	);
}
