import type Stripe from "stripe";

/**
 * Normalized view of a Stripe Identity VerificationSession. Keeps the raw
 * Stripe object inside this package; callers act on plain fields. `clientSecret`
 * is only populated by Stripe on creation (used to open the verification modal
 * with `stripe.verifyIdentity`); retrieves return it as null.
 */
export interface IdentityVerificationSnapshot {
	id: string;
	clientSecret: string | null;
	url: string | null;
	status: Stripe.Identity.VerificationSession["status"];
}

function snapshot(
	session: Stripe.Identity.VerificationSession,
): IdentityVerificationSnapshot {
	return {
		id: session.id,
		clientSecret: session.client_secret ?? null,
		url: session.url ?? null,
		status: session.status,
	};
}

/**
 * Creates a document VerificationSession for a guest. `metadata.userId` is the
 * link the webhook reads to attribute the outcome back to the profile. A
 * matching selfie is required so a stolen document alone cannot verify.
 */
export async function createIdentityVerificationSession(
	stripe: Stripe,
	params: { userId: string; returnUrl?: string },
): Promise<IdentityVerificationSnapshot> {
	const session = await stripe.identity.verificationSessions.create({
		type: "document",
		metadata: { userId: params.userId },
		options: { document: { require_matching_selfie: true } },
		...(params.returnUrl ? { return_url: params.returnUrl } : {}),
	});
	return snapshot(session);
}

/** Retrieves the current state of a VerificationSession by id. */
export async function retrieveIdentityVerificationSession(
	stripe: Stripe,
	sessionId: string,
): Promise<IdentityVerificationSnapshot> {
	const session =
		await stripe.identity.verificationSessions.retrieve(sessionId);
	return snapshot(session);
}
