import type {
	HostkitAddGuestInput,
	HostkitGuestDocumentType,
} from "../integrations/hostkit";
import {
	HostkitApiError,
	HostkitNetworkError,
	HostkitTimeoutError,
} from "../integrations/hostkit";
import { countryAlpha3 } from "./country-codes";

/** Hostkit field limits from the addGuest endpoint documentation. */
const HOSTKIT_NAME_MAX_LENGTH = 40;
const HOSTKIT_DOCUMENT_ID_MAX_LENGTH = 16;

/**
 * Decrypted identity fields of one roster slot, as read from
 * `booking_guests`. All values are plaintext at this boundary; nothing here
 * may be logged.
 */
export interface GuestSubmissionGuest {
	dateOfBirth: string | null;
	documentIssuingCountry: string | null;
	documentNumber: string | null;
	documentType: string | null;
	firstName: string | null;
	lastName: string | null;
	nationality: string | null;
	position: number;
	residenceCountry: string | null;
}

export interface GuestSubmissionStay {
	/** Check-in date, YYYY-MM-DD in the property timezone. */
	arrival: string;
	/** Check-out date, YYYY-MM-DD in the property timezone. */
	departure: string;
	/** Provider reservation code (Hostify confirmation code). */
	rcode: string;
}

export type BuildGuestResult =
	| { kind: "ok"; guest: HostkitAddGuestInput }
	| {
			/**
			 * PII-safe description of what blocks the slot (field names and the
			 * slot position only, never values).
			 */
			kind: "incomplete";
			missing: string[];
	  };

/**
 * Maps our stored document type (Stripe Identity vocabulary or the Hostkit
 * codes themselves) to Hostkit's P / ID / O enumeration. Unknown types fall
 * back to O (other) rather than blocking the legal submission.
 */
export function mapHostkitDocumentType(
	documentType: string,
): HostkitGuestDocumentType {
	switch (documentType.trim().toLowerCase()) {
		case "p":
		case "passport":
			return "P";
		case "id":
		case "id_card":
		case "identity_card":
			return "ID";
		default:
			return "O";
	}
}

/**
 * Builds the Hostkit addGuest payload for one roster slot, reporting which
 * required fields are missing instead of submitting a partial bulletin.
 */
export function buildHostkitGuest(
	guest: GuestSubmissionGuest,
	stay: GuestSubmissionStay,
): BuildGuestResult {
	const missing: string[] = [];

	const firstName = guest.firstName?.trim() || null;
	const lastName = guest.lastName?.trim() || null;
	const dateOfBirth = guest.dateOfBirth?.trim() || null;
	const documentNumber = guest.documentNumber?.trim() || null;
	const documentType = guest.documentType?.trim() || null;
	const nationality = countryAlpha3(guest.nationality);
	const residenceCountry = countryAlpha3(guest.residenceCountry);
	const documentCountry = countryAlpha3(guest.documentIssuingCountry);

	if (!firstName) {
		missing.push("firstName");
	}
	if (!lastName) {
		missing.push("lastName");
	}
	if (!dateOfBirth) {
		missing.push("dateOfBirth");
	}
	if (!nationality) {
		missing.push("nationality");
	}
	if (!residenceCountry) {
		missing.push("residenceCountry");
	}
	if (!documentNumber) {
		missing.push("documentNumber");
	} else if (documentNumber.length > HOSTKIT_DOCUMENT_ID_MAX_LENGTH) {
		missing.push("documentNumber(too long)");
	}
	if (firstName && firstName.length > HOSTKIT_NAME_MAX_LENGTH) {
		missing.push("firstName(too long)");
	}
	if (lastName && lastName.length > HOSTKIT_NAME_MAX_LENGTH) {
		missing.push("lastName(too long)");
	}
	if (!documentType) {
		missing.push("documentType");
	}
	if (!documentCountry) {
		missing.push("documentIssuingCountry");
	}

	if (
		missing.length > 0 ||
		!firstName ||
		!lastName ||
		!dateOfBirth ||
		!nationality ||
		!residenceCountry ||
		!documentNumber ||
		!documentType ||
		!documentCountry
	) {
		return { kind: "incomplete", missing };
	}

	return {
		guest: {
			arrival: stay.arrival,
			birthday: dateOfBirth,
			countryResidence: residenceCountry,
			departure: stay.departure,
			documentCountry,
			documentId: documentNumber,
			documentType: mapHostkitDocumentType(documentType),
			firstName: firstName.slice(0, HOSTKIT_NAME_MAX_LENGTH),
			lastName: lastName.slice(0, HOSTKIT_NAME_MAX_LENGTH),
			nationality,
			rcode: stay.rcode,
		},
		kind: "ok",
	};
}

/**
 * How a failed Hostkit call affects the submission job.
 *
 * `awaiting_provider` is the signature Hostkit-lag case: reservations reach
 * Hostkit asynchronously (from the channel/PMS side), so "Unknown reservation
 * code" right after checkout means "not ingested yet", not "wrong code" — the
 * job must retry later without burning trust in the data.
 */
export type GuestSubmissionErrorKind =
	| "awaiting_provider"
	| "permanent"
	| "transient";

const AWAITING_PROVIDER_PATTERN =
	/unknown reservation code|reservation not found/i;

export function classifyGuestSubmissionError(
	error: unknown,
): GuestSubmissionErrorKind {
	if (error instanceof HostkitApiError) {
		if (
			error.providerMessage &&
			AWAITING_PROVIDER_PATTERN.test(error.providerMessage)
		) {
			return "awaiting_provider";
		}
		return error.retryable ? "transient" : "permanent";
	}
	if (
		error instanceof HostkitTimeoutError ||
		error instanceof HostkitNetworkError
	) {
		return "transient";
	}
	return "permanent";
}

/**
 * Retry delay ladder for guest submissions. Front-loaded for transient
 * blips, then spaced out to ride Hostkit's ingestion lag (which can be
 * hours) without hammering the 100 req/min budget.
 */
const RETRY_DELAY_MINUTES = [5, 15, 45, 120, 360] as const;

export function nextGuestSubmissionDelayMs(attemptCount: number): number {
	const index = Math.min(
		Math.max(attemptCount - 1, 0),
		RETRY_DELAY_MINUTES.length - 1,
	);
	const minutes = RETRY_DELAY_MINUTES[index] ?? 360;
	return minutes * 60 * 1000;
}

/** Default attempt budget: the delay ladder plus ~2 days of 6h retries. */
export const DEFAULT_GUEST_SUBMISSION_MAX_ATTEMPTS = 12;
