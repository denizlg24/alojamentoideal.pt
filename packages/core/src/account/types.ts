import type { IdentityVerificationStatus } from "@workspace/db";

export type { IdentityVerificationStatus };

/**
 * Editable guest-profile fields a user manages from their account. Mirrors the
 * checkout contact shape (`orderContact` / `ContactDraft`) so a saved profile
 * can pre-fill the checkout contact step. All fields are optional: a profile is
 * built up incrementally.
 */
export interface AccountProfileInput {
	phoneE164: string | null;
	isCompany: boolean;
	companyName: string | null;
	taxNumber: string | null;
	billingLine1: string | null;
	billingLine2: string | null;
	billingCity: string | null;
	billingRegion: string | null;
	billingPostalCode: string | null;
	/** ISO 3166-1 alpha-2. */
	billingCountry: string | null;
	/** ISO 3166-1 alpha-2. */
	residenceCountry: string | null;
	/** ISO 3166-1 alpha-2. */
	nationality: string | null;
}

/**
 * Full profile returned to the client: the editable fields plus read-only
 * identity-verification state. The Stripe verification session id is internal
 * and never leaves the server.
 */
export interface AccountProfile extends AccountProfileInput {
	identityStatus: IdentityVerificationStatus;
	/** ISO 8601 timestamp the identity last reached `verified`, else null. */
	identityVerifiedAt: string | null;
}
