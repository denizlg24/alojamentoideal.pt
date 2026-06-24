import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/account-skeleton";
import { AccountView } from "@/components/account/account-view";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { accountProfileRepository } from "@/lib/api/account";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Your account" };

async function AccountData() {
	const user = await getCurrentUser();
	if (!user) {
		redirect("/login?next=/account");
	}

	const profile = await accountProfileRepository().getProfile(user.id);

	return (
		<AccountView
			profile={profile}
			user={{
				dateOfBirth: user.dateOfBirth ?? null,
				email: user.email,
				image: user.image ?? null,
				name: user.name,
			}}
		/>
	);
}

export default function AccountPage() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<Suspense fallback={<AccountSkeleton />}>
					<AccountData />
				</Suspense>
			</main>
			<SiteFooter />
		</div>
	);
}
