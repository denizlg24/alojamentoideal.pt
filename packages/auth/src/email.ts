export interface VerificationEmail {
	email: string;
	url: string;
}

/**
 * Placeholder verification-email sender. Replace with a real transactional
 * email provider (Resend, SES, etc.) before enabling email verification in
 * production. For now it logs the verification link so local flows are usable.
 */
export async function sendVerificationEmail({
	email,
	url,
}: VerificationEmail): Promise<void> {
	console.info(`[auth] verification email for ${email}: ${url}`);
}
