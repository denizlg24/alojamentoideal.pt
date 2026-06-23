import { getAuthConfig } from "@workspace/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { RegisterForm } from "@/components/auth/register-form";
import { safeNextPath, signedInRedirectTarget } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create your account" };

type SearchParams = Record<string, string | string[] | undefined>;

async function RegisterContent({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const sp = await searchParams;
	const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);

	// Already signed in: skip registration and send them on their way.
	if (await getCurrentUser()) {
		redirect(signedInRedirectTarget(next));
	}

	const googleEnabled = Boolean(getAuthConfig().google);

	return (
		<AuthCard
			footer={
				<>
					Already have an account?{" "}
					<Link
						className="underline"
						href={`/login?next=${encodeURIComponent(next)}`}
					>
						Log in
					</Link>
				</>
			}
			subtitle="It only takes a minute."
			title="Create your account"
		>
			<AuthReturnLink next={next} />
			<RegisterForm googleEnabled={googleEnabled} next={next} />
		</AuthCard>
	);
}

export default function RegisterPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	return (
		<Suspense fallback={null}>
			<RegisterContent searchParams={searchParams} />
		</Suspense>
	);
}
