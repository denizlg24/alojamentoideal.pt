import {
	type Database,
	type IdentityDocumentStatus,
	type IdentityVerificationStatus,
	userIdentityDocument,
	userProfile,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
	decryptIdentityField,
	encryptIdentityField,
	getAccountIdentityEncryptionKey,
} from "./identity-encryption";
import type {
	AccountIdentityDocumentDisplay,
	AccountProfile,
	AccountProfileInput,
	VerifiedIdentityDocumentFields,
} from "./types";

type UserProfileRow = typeof userProfile.$inferSelect;
type UserIdentityDocumentRow = typeof userIdentityDocument.$inferSelect;
type UserIdentityDocumentInsert = typeof userIdentityDocument.$inferInsert;

export interface AccountIdentityResetTarget {
	status: IdentityDocumentStatus;
	stripeVerificationSessionId: string | null;
}

const EMPTY_IDENTITY: AccountIdentityDocumentDisplay = {
	documentType: null,
	expiresOn: null,
	issuingCountry: null,
	maskedDocumentNumber: null,
	nationality: null,
	status: "unstarted",
	verifiedAt: null,
};

const EMPTY_PROFILE: AccountProfile = {
	phoneE164: null,
	isCompany: false,
	companyName: null,
	taxNumber: null,
	billingLine1: null,
	billingLine2: null,
	billingCity: null,
	billingRegion: null,
	billingPostalCode: null,
	billingCountry: null,
	residenceCountry: null,
	nationality: null,
	identity: EMPTY_IDENTITY,
	identityStatus: "unstarted",
	identityVerifiedAt: null,
};

function cleanDisplayValue(value: string | null): string | null {
	if (!value || value === "[redacted]") {
		return null;
	}
	return value;
}

function maskDocumentNumber(value: string | null): string | null {
	const cleaned = cleanDisplayValue(value)?.replace(/\s/g, "");
	if (!cleaned) {
		return null;
	}
	const suffix = cleaned.slice(-4);
	return suffix.length > 0 ? `***${suffix}` : null;
}

function toIdentityDisplay(
	row: UserIdentityDocumentRow | undefined,
): AccountIdentityDocumentDisplay {
	if (!row) {
		return { ...EMPTY_IDENTITY };
	}

	if (row.status !== "verified") {
		return {
			...EMPTY_IDENTITY,
			status: row.status,
			verifiedAt: row.verifiedAt?.toISOString() ?? null,
		};
	}

	const key = getAccountIdentityEncryptionKey();
	const documentNumber = decryptIdentityField(row.documentNumberEncrypted, key);

	return {
		documentType: cleanDisplayValue(
			decryptIdentityField(row.documentTypeEncrypted, key),
		),
		expiresOn: cleanDisplayValue(
			decryptIdentityField(row.documentExpiresOnEncrypted, key),
		),
		issuingCountry: cleanDisplayValue(
			decryptIdentityField(row.documentIssuingCountryEncrypted, key),
		),
		maskedDocumentNumber: maskDocumentNumber(documentNumber),
		nationality: cleanDisplayValue(
			decryptIdentityField(row.nationalityEncrypted, key),
		),
		status: row.status,
		verifiedAt: row.verifiedAt?.toISOString() ?? null,
	};
}

function toProfile(
	row: UserProfileRow | undefined,
	identity: AccountIdentityDocumentDisplay,
): AccountProfile {
	return {
		phoneE164: row?.phoneE164 ?? null,
		isCompany: row?.isCompany ?? false,
		companyName: row?.companyName ?? null,
		taxNumber: row?.taxNumber ?? null,
		billingLine1: row?.billingLine1 ?? null,
		billingLine2: row?.billingLine2 ?? null,
		billingCity: row?.billingCity ?? null,
		billingRegion: row?.billingRegion ?? null,
		billingPostalCode: row?.billingPostalCode ?? null,
		billingCountry: row?.billingCountry ?? null,
		residenceCountry: row?.residenceCountry ?? null,
		nationality: row?.nationality ?? null,
		identity,
		identityStatus: identity.status,
		identityVerifiedAt: identity.verifiedAt,
	};
}

function encryptedIdentityFields(
	fields: VerifiedIdentityDocumentFields,
): Partial<UserIdentityDocumentInsert> {
	const key = getAccountIdentityEncryptionKey();

	return {
		dateOfBirthEncrypted: encryptIdentityField(fields.dateOfBirth, key),
		documentExpiresOnEncrypted: encryptIdentityField(
			fields.documentExpiresOn,
			key,
		),
		documentIssuingCountryEncrypted: encryptIdentityField(
			fields.documentIssuingCountry,
			key,
		),
		documentNumberEncrypted: encryptIdentityField(fields.documentNumber, key),
		documentTypeEncrypted: encryptIdentityField(fields.documentType, key),
		firstNameEncrypted: encryptIdentityField(fields.firstName, key),
		lastNameEncrypted: encryptIdentityField(fields.lastName, key),
		nationalityEncrypted: encryptIdentityField(fields.nationality, key),
		stripeVerificationReportId: fields.stripeVerificationReportId,
	};
}

/**
 * Data access for the optional `user_profile` row. Mirrors the catalog/commerce
 * repositories: stateless, constructed per request with an injected Drizzle
 * client. Reads return a fully-defaulted profile so callers never branch on the
 * row's existence; writes upsert the single row keyed by `userId`.
 */
export class AccountProfileRepository {
	constructor(private readonly db: Database) {}

	async getProfile(userId: string): Promise<AccountProfile> {
		const [profileRows, identityRows] = await Promise.all([
			this.db
				.select()
				.from(userProfile)
				.where(eq(userProfile.userId, userId))
				.limit(1),
			this.db
				.select()
				.from(userIdentityDocument)
				.where(
					sql`${userIdentityDocument.userId} = ${userId}
						and ${userIdentityDocument.purgedAt} is null`,
				)
				.orderBy(
					sql`case when ${userIdentityDocument.status} = 'verified' then 0 else 1 end`,
					desc(userIdentityDocument.updatedAt),
				)
				.limit(1),
		]);

		const identity = toIdentityDisplay(identityRows[0]);
		return profileRows[0] || identityRows[0]
			? toProfile(profileRows[0], identity)
			: { ...EMPTY_PROFILE, identity };
	}

	async updateProfile(
		userId: string,
		input: AccountProfileInput,
	): Promise<AccountProfile> {
		const now = new Date();
		const [row] = await this.db
			.insert(userProfile)
			.values({ userId, ...input, updatedAt: now })
			.onConflictDoUpdate({
				target: userProfile.userId,
				set: { ...input, updatedAt: now },
			})
			.returning();
		// `returning` on an upsert always yields exactly one row.
		const current = await this.getProfile(userId);
		return toProfile(row as UserProfileRow, current.identity);
	}

	/**
	 * Records the freshly-created Stripe verification session against the
	 * account identity document ledger. The session id is the reconciliation key
	 * the webhook later matches on.
	 */
	async linkIdentitySession(
		userId: string,
		sessionId: string,
		status: IdentityDocumentStatus,
	): Promise<void> {
		const now = new Date();
		await this.db
			.insert(userIdentityDocument)
			.values({
				id: crypto.randomUUID(),
				userId,
				source: "stripe_identity",
				status,
				stripeVerificationSessionId: sessionId,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: userIdentityDocument.stripeVerificationSessionId,
				targetWhere: sql`${userIdentityDocument.stripeVerificationSessionId} is not null`,
				set: {
					status,
					updatedAt: now,
					userId,
				},
			});
	}

	async hasIdentitySession(sessionId: string): Promise<boolean> {
		const [row] = await this.db
			.select({ id: userIdentityDocument.id })
			.from(userIdentityDocument)
			.where(
				and(
					eq(userIdentityDocument.stripeVerificationSessionId, sessionId),
					isNull(userIdentityDocument.purgedAt),
				),
			)
			.limit(1);

		return Boolean(row);
	}

	async listIdentityResetTargets(
		userId: string,
	): Promise<AccountIdentityResetTarget[]> {
		return this.db
			.select({
				status: userIdentityDocument.status,
				stripeVerificationSessionId:
					userIdentityDocument.stripeVerificationSessionId,
			})
			.from(userIdentityDocument)
			.where(
				and(
					eq(userIdentityDocument.userId, userId),
					isNull(userIdentityDocument.purgedAt),
				),
			)
			.orderBy(desc(userIdentityDocument.updatedAt));
	}

	async deleteIdentityDocumentsForUser(userId: string): Promise<number> {
		const rows = await this.db
			.delete(userIdentityDocument)
			.where(eq(userIdentityDocument.userId, userId))
			.returning({ id: userIdentityDocument.id });

		return rows.length;
	}

	/**
	 * Applies a verification status transition delivered by the Stripe webhook,
	 * matched on the session id. Idempotent: re-delivered events resolve to the
	 * same terminal state. Returns the affected `userId`, or null when the local
	 * document row no longer exists, such as after a user reset/deletion request.
	 */
	async applyIdentityStatus({
		sessionId,
		status,
		statusChangedAt,
		verifiedFields,
	}: {
		sessionId: string;
		status: IdentityDocumentStatus;
		statusChangedAt: string | null;
		verifiedFields?: VerifiedIdentityDocumentFields;
	}): Promise<string | null> {
		const [existing] = await this.db
			.select()
			.from(userIdentityDocument)
			.where(
				and(
					eq(userIdentityDocument.stripeVerificationSessionId, sessionId),
					isNull(userIdentityDocument.purgedAt),
				),
			)
			.limit(1);

		if (!existing) {
			return null;
		}

		const now = new Date();
		const statusAt = statusChangedAt ? new Date(statusChangedAt) : now;
		const set: Partial<UserIdentityDocumentInsert> = {
			status,
			updatedAt: new Date(),
		};

		if (
			(status === "processing" || status === "verified") &&
			!existing?.submittedAt
		) {
			set.submittedAt = statusAt;
		}

		if (status === "verified") {
			set.verifiedAt = statusAt;
			if (!verifiedFields) {
				throw new Error("verified identity fields are required");
			}
			Object.assign(set, encryptedIdentityFields(verifiedFields));
		}

		const rows = await this.db
			.update(userIdentityDocument)
			.set(set)
			.where(eq(userIdentityDocument.id, existing.id))
			.returning({ userId: userIdentityDocument.userId });

		return rows[0]?.userId ?? null;
	}
}
