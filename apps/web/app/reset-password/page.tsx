import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Choose a new password",
	description: "Set a new password for your Alojamento Ideal account.",
});

type SearchParams = Record<string, string | string[] | undefined>;

async function ResetContent({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const sp = await searchParams;
	const token = typeof sp.token === "string" ? sp.token : null;

	return (
		<AuthCard
			subtitle="Pick a strong password you don't use elsewhere."
			title="Choose a new password"
		>
			<ResetPasswordForm token={token} />
		</AuthCard>
	);
}

export default function ResetPasswordPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	return (
		<Suspense fallback={null}>
			<ResetContent searchParams={searchParams} />
		</Suspense>
	);
}
