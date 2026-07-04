import { AdminNav } from "@/components/admin-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdminUser } from "@/lib/auth/admin";

export default async function DashboardLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const user = await requireAdminUser();

	return (
		<div className="flex min-h-svh">
			<aside className="flex w-52 shrink-0 flex-col border-border/60 border-r px-4 py-6">
				<div className="px-2">
					<p className="font-display font-semibold text-sm tracking-tight">
						Alojamento Ideal
					</p>
					<p className="text-muted-foreground text-xs">Operations</p>
				</div>
				<AdminNav className="mt-8 flex-1" />
				<div className="space-y-2 px-2">
					<p
						className="truncate text-muted-foreground text-xs"
						title={user.email}
					>
						{user.email}
					</p>
					<SignOutButton />
				</div>
			</aside>
			<main className="min-w-0 flex-1 px-8 py-8">{children}</main>
		</div>
	);
}
