import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Reset your password",
	description:
		"Request a password reset link for your Alojamento Ideal account.",
});

export default function ForgotPasswordPage() {
	return (
		<AuthCard
			subtitle="Enter your email and we'll send you a reset link."
			title="Reset your password"
		>
			<ForgotPasswordForm />
		</AuthCard>
	);
}
