import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/home/site-header";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
	const user = await getCurrentUser();
	if (!user) {
		redirect("/login?next=/account");
	}

	return (
		<>
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-3xl px-4 pt-24 pb-16 sm:px-6">
				<header className="mb-8">
					<h1 className="font-heading font-semibold text-3xl">
						Hi {user.name?.split(" ")[0] || "there"}
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Manage your details and review your stays with Alojamento Ideal.
					</p>
				</header>

				<section className="rounded-2xl border bg-card p-6 shadow-sm">
					<h2 className="font-heading font-semibold text-lg">Your details</h2>
					<dl className="mt-4 grid gap-4 sm:grid-cols-2">
						<div>
							<dt className="text-muted-foreground text-xs uppercase tracking-wide">
								Name
							</dt>
							<dd className="mt-1 text-sm">{user.name || "Not set"}</dd>
						</div>
						<div>
							<dt className="text-muted-foreground text-xs uppercase tracking-wide">
								Email
							</dt>
							<dd className="mt-1 text-sm">{user.email}</dd>
						</div>
					</dl>
					<p className="mt-6 text-muted-foreground text-sm">
						Bookings and saved details will appear here soon.
					</p>
				</section>
			</main>
		</>
	);
}
