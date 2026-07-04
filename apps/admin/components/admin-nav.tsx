"use client";

import { cn } from "@workspace/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
	{ href: "/orders", label: "Orders" },
	{ href: "/observability", label: "Observability" },
	{ href: "/users", label: "Users" },
] as const;

export function AdminNav({ className }: { className?: string }) {
	const pathname = usePathname();

	return (
		<nav className={cn("space-y-1", className)}>
			{links.map((link) => {
				const active =
					pathname === link.href || pathname.startsWith(`${link.href}/`);
				return (
					<Link
						className={cn(
							"block rounded-md px-2 py-1.5 text-sm transition-colors",
							active
								? "font-medium text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						href={link.href}
						key={link.href}
					>
						{link.label}
					</Link>
				);
			})}
		</nav>
	);
}
