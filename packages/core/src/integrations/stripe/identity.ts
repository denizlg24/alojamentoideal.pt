import type Stripe from "stripe";
import type { VerifiedIdentityDocumentFields } from "../../account/types";

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
 * link the webhook reads to attribute the outcome back to the account identity
 * document row. A matching selfie is required so a stolen document alone cannot
 * verify.
 */
export async function createIdentityVerificationSession(
	stripe: Stripe,
	params: { userId: string; returnUrl?: string },
): Promise<IdentityVerificationSnapshot> {
	const session = await stripe.identity.verificationSessions.create({
		type: "document",
		client_reference_id: params.userId,
		metadata: { userId: params.userId },
		options: { document: { require_matching_selfie: true } },
		...(params.returnUrl ? { return_url: params.returnUrl } : {}),
	});
	return snapshot(session);
}

/**
 * Creates a document VerificationSession for an order guest. This is intentionally
 * keyed to `bookingGuest.id`, not a signed-in account, so magic-link order access
 * can complete verification without requiring registration.
 */
export async function createGuestIdentityVerificationSession(
	stripe: Stripe,
	params: {
		bookingGuestId: string;
		orderId: string;
		providerBookingId: string;
		returnUrl?: string;
	},
): Promise<IdentityVerificationSnapshot> {
	const session = await stripe.identity.verificationSessions.create({
		type: "document",
		client_reference_id: params.bookingGuestId,
		metadata: {
			bookingGuestId: params.bookingGuestId,
			orderId: params.orderId,
			providerBookingId: params.providerBookingId,
		},
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

export type IdentityVerificationResetOutcome =
	| "canceled"
	| "redacted"
	| "skipped";

/**
 * Best-effort remote cleanup for a Stripe Identity session. Stripe allows
 * redaction for verified/requires_input sessions; processing sessions may later
 * emit a webhook, which the account repository treats as a no-op after local
 * deletion.
 */
export async function resetIdentityVerificationSession(
	stripe: Stripe,
	params: {
		sessionId: string;
		status: Stripe.Identity.VerificationSession["status"];
	},
): Promise<IdentityVerificationResetOutcome> {
	if (params.status === "verified" || params.status === "requires_input") {
		await stripe.identity.verificationSessions.redact(params.sessionId);
		return "redacted";
	}

	if (params.status === "canceled") {
		return "skipped";
	}

	return "skipped";
}

type StripeDateParts = {
	day: number | null;
	month: number | null;
	year: number | null;
};

function cleanStripeValue(value: string | null | undefined): string | null {
	if (!value || value === "[redacted]") {
		return null;
	}
	return value;
}

function stripeDateToIso(
	value: StripeDateParts | null | undefined,
): string | null {
	if (
		!value ||
		value.year === null ||
		value.month === null ||
		value.day === null
	) {
		return null;
	}

	const month = String(value.month).padStart(2, "0");
	const day = String(value.day).padStart(2, "0");
	return `${value.year}-${month}-${day}`;
}

function lastReportId(
	session: Stripe.Identity.VerificationSession,
): string | null {
	const report = session.last_verification_report;
	if (!report) {
		return null;
	}
	return typeof report === "string" ? report : report.id;
}

async function retrieveLastVerificationReport(
	stripe: Stripe,
	session: Stripe.Identity.VerificationSession,
): Promise<Stripe.Identity.VerificationReport | null> {
	const report = session.last_verification_report;
	if (!report) {
		return null;
	}
	if (typeof report !== "string") {
		return report;
	}
	return stripe.identity.verificationReports.retrieve(report);
}

/**
 * Retrieves and normalizes only the scalar Stripe Identity fields the app is
 * allowed to persist. Raw Stripe payloads and document/selfie file ids are
 * intentionally discarded by this boundary.
 */
export async function retrieveVerifiedIdentityDocumentFields(
	stripe: Stripe,
	sessionId: string,
): Promise<VerifiedIdentityDocumentFields> {
	const session = await stripe.identity.verificationSessions.retrieve(
		sessionId,
		{ expand: ["last_verification_report"] },
	);
	const report = await retrieveLastVerificationReport(stripe, session);
	const document =
		report?.document?.status === "verified" ? report.document : null;
	const verifiedOutputs =
		session.status === "verified" ? session.verified_outputs : null;

	return {
		dateOfBirth: stripeDateToIso(verifiedOutputs?.dob ?? document?.dob),
		documentExpiresOn: stripeDateToIso(document?.expiration_date),
		documentIssuingCountry: cleanStripeValue(document?.issuing_country),
		documentNumber: cleanStripeValue(document?.number),
		documentType: cleanStripeValue(document?.type),
		firstName: cleanStripeValue(
			verifiedOutputs?.first_name ?? document?.first_name,
		),
		lastName: cleanStripeValue(
			verifiedOutputs?.last_name ?? document?.last_name,
		),
		nationality: null,
		stripeVerificationReportId: report?.id ?? lastReportId(session),
	};
}
