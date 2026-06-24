import {
	type Database,
	type IdentityVerificationStatus,
	userProfile,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AccountProfile, AccountProfileInput } from "./types";

type UserProfileRow = typeof userProfile.$inferSelect;

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
	identityStatus: "unstarted",
	identityVerifiedAt: null,
};

function toProfile(row: UserProfileRow): AccountProfile {
	return {
		phoneE164: row.phoneE164,
		isCompany: row.isCompany,
		companyName: row.companyName,
		taxNumber: row.taxNumber,
		billingLine1: row.billingLine1,
		billingLine2: row.billingLine2,
		billingCity: row.billingCity,
		billingRegion: row.billingRegion,
		billingPostalCode: row.billingPostalCode,
		billingCountry: row.billingCountry,
		residenceCountry: row.residenceCountry,
		nationality: row.nationality,
		identityStatus: row.identityStatus,
		identityVerifiedAt: row.identityVerifiedAt?.toISOString() ?? null,
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
		const [row] = await this.db
			.select()
			.from(userProfile)
			.where(eq(userProfile.userId, userId))
			.limit(1);
		return row ? toProfile(row) : { ...EMPTY_PROFILE };
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
		return toProfile(row as UserProfileRow);
	}

	/**
	 * Records the freshly-created Stripe verification session against the
	 * profile, creating the row if the user has no profile yet. The session id is
	 * the reconciliation key the webhook later matches on.
	 */
	async linkIdentitySession(
		userId: string,
		sessionId: string,
		status: IdentityVerificationStatus,
	): Promise<void> {
		const now = new Date();
		await this.db
			.insert(userProfile)
			.values({
				userId,
				identityVerificationSessionId: sessionId,
				identityStatus: status,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: userProfile.userId,
				set: {
					identityVerificationSessionId: sessionId,
					identityStatus: status,
					updatedAt: now,
				},
			});
	}

	/**
	 * Applies a verification status transition delivered by the Stripe webhook,
	 * matched on the session id. Idempotent: re-delivered events resolve to the
	 * same terminal state. Returns the affected `userId`, or null when no profile
	 * references the session (e.g. the user was deleted).
	 */
	async applyIdentityStatus(
		sessionId: string,
		status: IdentityVerificationStatus,
		verifiedAt: string | null,
	): Promise<string | null> {
		const set: Partial<UserProfileRow> = {
			identityStatus: status,
			updatedAt: new Date(),
		};
		if (status === "verified") {
			set.identityVerifiedAt = verifiedAt ? new Date(verifiedAt) : new Date();
		}

		const rows = await this.db
			.update(userProfile)
			.set(set)
			.where(eq(userProfile.identityVerificationSessionId, sessionId))
			.returning({ userId: userProfile.userId });

		return rows[0]?.userId ?? null;
	}
}
