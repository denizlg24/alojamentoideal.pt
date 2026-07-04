import { Separator } from "@workspace/ui/components/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { House } from "lucide-react";
import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdminUser } from "@/lib/auth/admin";

export default async function DashboardLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const [user, cookieStore] = await Promise.all([
		requireAdminUser(),
		cookies(),
	]);
	const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

	return (
		<SidebarProvider defaultOpen={defaultOpen}>
			<Sidebar collapsible="icon">
				<SidebarHeader className="px-3 py-4">
					<div className="flex min-w-0 items-center gap-2 px-2">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
							<House aria-hidden className="size-4" />
						</div>
						<div className="min-w-0 group-data-[collapsible=icon]:hidden">
							<p className="truncate font-display font-semibold text-sm tracking-tight">
								Alojamento Ideal
							</p>
							<p className="text-muted-foreground text-xs">Operations</p>
						</div>
					</div>
				</SidebarHeader>
				<SidebarSeparator />
				<SidebarContent>
					<AdminNav />
				</SidebarContent>
				<SidebarFooter className="px-3 py-4">
					<p
						className="truncate px-2 text-muted-foreground text-xs group-data-[collapsible=icon]:sr-only"
						title={user.email}
					>
						{user.email}
					</p>
					<SignOutButton className="w-full justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:[&_span]:sr-only" />
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<SidebarInset>
				<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-border/60 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
					<SidebarTrigger />
					<Separator className="h-4" orientation="vertical" />
					<span className="font-medium text-sm">Operations</span>
				</header>
				<div className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
