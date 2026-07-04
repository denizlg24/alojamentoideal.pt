import { randomUUID } from "node:crypto";
import { account, getDb, user } from "@workspace/db";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

/**
 * Deploy-time seed: guarantees the account behind ROOT_ADMIN_EMAIL exists and
 * holds the Better Auth admin role. Runs after migrations in the admin app's
 * Vercel build (see apps/admin/vercel.json) and is idempotent:
 *
 * - user exists            -> promote to admin + mark email verified
 * - user missing           -> create user + credential account (password from
 *                             ROOT_ADMIN_PASSWORD, hashed with Better Auth's
 *                             own scrypt hasher so email/password sign-in works)
 * - env not configured     -> warn and skip, never fail the build
 *
 * Direct row writes are deliberate: going through Better Auth sign-up would
 * fire the verification email on every deploy.
 */
async function seedRootAdmin(): Promise<void> {
	const email = process.env.ROOT_ADMIN_EMAIL?.trim().toLowerCase();
	if (!email) {
		console.warn(
			"seed-root-admin: ROOT_ADMIN_EMAIL is not set; skipping root admin seed.",
		);
		return;
	}

	const db = getDb();
	const [existing] = await db
		.select({
			emailVerified: user.emailVerified,
			id: user.id,
			role: user.role,
		})
		.from(user)
		.where(eq(user.email, email))
		.limit(1);

	if (existing) {
		if (existing.role === "admin" && existing.emailVerified) {
			console.log(`seed-root-admin: ${email} is already an admin.`);
			return;
		}
		await db
			.update(user)
			.set({ emailVerified: true, role: "admin", updatedAt: new Date() })
			.where(eq(user.id, existing.id));
		console.log(`seed-root-admin: promoted ${email} to admin.`);
		return;
	}

	const password = process.env.ROOT_ADMIN_PASSWORD;
	if (!password || password.length < 8) {
		console.warn(
			`seed-root-admin: ${email} does not exist and ROOT_ADMIN_PASSWORD is missing or shorter than 8 characters; skipping creation.`,
		);
		return;
	}

	const now = new Date();
	const userId = randomUUID();
	const hashedPassword = await hashPassword(password);
	await db.transaction(async (tx) => {
		await tx.insert(user).values({
			createdAt: now,
			email,
			emailVerified: true,
			id: userId,
			name: email.split("@")[0] ?? "Root admin",
			role: "admin",
			updatedAt: now,
		});
		await tx.insert(account).values({
			accountId: userId,
			createdAt: now,
			id: randomUUID(),
			password: hashedPassword,
			providerId: "credential",
			updatedAt: now,
			userId,
		});
	});
	console.log(`seed-root-admin: created admin account for ${email}.`);
}

try {
	await seedRootAdmin();
	// The pg pool keeps the event loop alive; exit explicitly once done.
	process.exit(0);
} catch (error) {
	console.error("seed-root-admin: failed", error);
	process.exit(1);
}
