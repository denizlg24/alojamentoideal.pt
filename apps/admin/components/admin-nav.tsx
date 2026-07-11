"use client";

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import {
	Activity,
	BookOpen,
	ContactRound,
	Landmark,
	Mail,
	ReceiptText,
	RefreshCcw,
	Settings,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
	{ href: "/orders", icon: ReceiptText, label: "Orders" },
	{ href: "/contacts", icon: Mail, label: "Contacts" },
	{ href: "/owner-contacts", icon: ContactRound, label: "Owner contacts" },
	{ href: "/help-articles", icon: BookOpen, label: "Help articles" },
	{ href: "/settlements/detours", icon: Landmark, label: "Settlements" },
	{ href: "/reconciliations", icon: RefreshCcw, label: "Reconciliations" },
	{ href: "/observability", icon: Activity, label: "Observability" },
	{ href: "/users", icon: Users, label: "Users" },
	{ href: "/settings", icon: Settings, label: "Settings" },
] as const;

export function AdminNav({ className }: { className?: string }) {
	const pathname = usePathname();

	return (
		<SidebarGroup className={cn("p-2", className)}>
			<SidebarGroupContent>
				<SidebarMenu>
					{links.map((link) => {
						const active =
							pathname === link.href || pathname.startsWith(`${link.href}/`);
						const Icon = link.icon;

						return (
							<SidebarMenuItem key={link.href}>
								<SidebarMenuButton
									asChild
									isActive={active}
									tooltip={link.label}
								>
									<Link href={link.href}>
										<Icon aria-hidden />
										<span>{link.label}</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
