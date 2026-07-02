import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath, signedInRedirectTarget } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Log in",
	description:
		"Log in to manage your Alojamento Ideal bookings and guest details.",
});

type SearchParams = Record<string, string | string[] | undefined>;

async function LoginContent({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const sp = await searchParams;
	const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);

	// Already signed in: there is nothing to log into, so bounce them onward.
	if (await getCurrentUser()) {
		redirect(signedInRedirectTarget(next));
	}

	return (
		<AuthCard
			footer={
				<>
					New to Alojamento Ideal?{" "}
					<Link
						className="underline"
						href={`/register?next=${encodeURIComponent(next)}`}
					>
						Create an account
					</Link>
				</>
			}
			subtitle="Log in to manage your stays."
			title="Welcome back"
		>
			<AuthReturnLink next={next} />
			<LoginForm next={next} />
		</AuthCard>
	);
}

export default function LoginPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	return (
		<Suspense fallback={null}>
			<LoginContent searchParams={searchParams} />
		</Suspense>
	);
}
