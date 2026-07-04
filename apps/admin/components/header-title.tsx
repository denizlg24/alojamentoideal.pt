"use client";

import { usePathname } from "next/navigation";

const SECTIONS = [
	{ label: "Orders", prefix: "/orders" },
	{ label: "Observability", prefix: "/observability" },
	{ label: "Users", prefix: "/users" },
] as const;

/** Reflects the active section in the top bar instead of a static label. */
export function HeaderTitle() {
	const pathname = usePathname();
	const section = SECTIONS.find(
		(entry) =>
			pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
	);
	return (
		<span className="font-medium text-sm">{section?.label ?? "Overview"}</span>
	);
}
