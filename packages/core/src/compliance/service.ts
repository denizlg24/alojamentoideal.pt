import {
	accommodationItemDetail as accommodationItemDetailTable,
	bookingGuest as bookingGuestTable,
	type Database,
	type GuestSubmissionJobStatus,
	guestSubmissionJob as guestSubmissionJobTable,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { decryptIdentityField } from "../account/identity-encryption";
import type { HostkitClient } from "../integrations/hostkit";
import { redactHostkitText } from "../integrations/hostkit";
import {
	buildHostkitGuest,
	classifyGuestSubmissionError,
	DEFAULT_GUEST_SUBMISSION_MAX_ATTEMPTS,
	type GuestSubmissionGuest,
	nextGuestSubmissionDelayMs,
} from "./guest-submission";

/**
 * How long after checkout a booking still qualifies for enqueueing. SIBA
 * bulletins are an at-arrival obligation; sweeping further back would only
 * backfill stays that must be resolved manually anyway.
 */
const DEFAULT_SWEEP_LOOKBACK_DAYS = 30;

/** Re-check cadence when a listing has no Hostkit key provisioned yet. */
const UNCONFIGURED_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

const ACTIVE_JOB_STATUSES: readonly GuestSubmissionJobStatus[] = [
	"pending",
	"retrying",
	"running",
];

export interface GuestComplianceServiceOptions {
	db: Database;
	maxAttempts?: number;
	now?: () => Date;
	/** Provider name whose bookings are covered by Hostkit (Hostify). */
	provider?: string;
	/** Returns the property-scoped Hostkit client, or null when not set up. */
	resolveHostkitClient: (listingId: string) => HostkitClient | null;
	/**
	 * Fallback for holds persisted before the Hostify confirmation code was
	 * available in `rawOperationalPayload` (re-reads the reservation).
	 */
	resolveReservationCode?: (
		providerReservationId: string,
	) => Promise<string | null>;
	/**
	 * When false (default), the job stops after `validateSIBA`: data is synced
	 * to Hostkit and validated, but the bulletin is not filed with the
	 * authorities. Flip only once the business signs off on auto-filing.
	 */
	sendSiba?: boolean;
	sweepLookbackDays?: number;
}

export interface GuestSubmissionSweepSummary {
	enqueued: number;
}

export interface GuestSubmissionProcessSummary {
	failed: number;
	notConfigured: number;
	processed: number;
	retried: number;
	skipped: number;
	succeeded: number;
}

export type GuestSubmissionRunSummary = GuestSubmissionProcessSummary &
	GuestSubmissionSweepSummary;

interface JobBookingRow {
	checkIn: string;
	checkOut: string;
	hostifyListingId: string;
	normalizedStatus: string;
	providerBookingId: string;
	providerReservationId: string | null;
	rawOperationalPayload: Record<string, unknown> | null;
}

/**
 * Drives Portuguese guest-registration compliance (M8 back half): syncs each
 * confirmed booking's completed roster to Hostkit and validates the SIBA
 * bulletin, tracked durably in `guest_submission_jobs`.
 *
 * The cron sweep is the only trigger: it enqueues eligible bookings and
 * re-enqueues when the roster changed after a terminal job, so the flow needs
 * no hooks inside the commerce mutations and recovers from any missed event.
 */
export class GuestComplianceService {
	readonly #db: Database;
	readonly #maxAttempts: number;
	readonly #now: () => Date;
	readonly #provider: string;
	readonly #resolveHostkitClient: GuestComplianceServiceOptions["resolveHostkitClient"];
	readonly #resolveReservationCode?: GuestComplianceServiceOptions["resolveReservationCode"];
	readonly #sendSiba: boolean;
	readonly #sweepLookbackDays: number;

	constructor(options: GuestComplianceServiceOptions) {
		this.#db = options.db;
		this.#maxAttempts =
			options.maxAttempts ?? DEFAULT_GUEST_SUBMISSION_MAX_ATTEMPTS;
		this.#now = options.now ?? (() => new Date());
		this.#provider = options.provider ?? "hostify";
		this.#resolveHostkitClient = options.resolveHostkitClient;
		this.#resolveReservationCode = options.resolveReservationCode;
		this.#sendSiba = options.sendSiba ?? false;
		this.#sweepLookbackDays =
			options.sweepLookbackDays ?? DEFAULT_SWEEP_LOOKBACK_DAYS;
	}

	/** Sweep + process in one cron tick. */
	async run(limit = 20): Promise<GuestSubmissionRunSummary> {
		const sweep = await this.sweepEligibleBookings(limit);
		const process = await this.processDueJobs(limit);
		return { ...sweep, ...process };
	}

	/**
	 * Enqueues a submission job for every confirmed booking whose roster is
	 * complete and not yet covered: no active job, and no terminal job newer
	 * than the roster's last change (so editing a guest after a successful
	 * submission re-syncs it).
	 */
	async sweepEligibleBookings(
		limit = 20,
	): Promise<GuestSubmissionSweepSummary> {
		const now = this.#now();
		const lookbackStart = new Date(
			now.getTime() - this.#sweepLookbackDays * 24 * 60 * 60 * 1000,
		);

		const guests = bookingGuestTable;
		const jobs = guestSubmissionJobTable;
		const bookings = providerBookingTable;

		const hasGuests = sql`exists (
			select 1 from ${guests}
			where ${guests.providerBookingId} = ${bookings.id}
		)`;
		const hasIncompleteGuest = sql`exists (
			select 1 from ${guests}
			where ${guests.providerBookingId} = ${bookings.id}
			and (
				${guests.firstNameEncrypted} is null
				or ${guests.lastNameEncrypted} is null
				or ${guests.dateOfBirthEncrypted} is null
				or ${guests.nationalityEncrypted} is null
				or ${guests.residenceCountryEncrypted} is null
				or ${guests.documentNumberEncrypted} is null
				or ${guests.documentTypeEncrypted} is null
				or ${guests.documentIssuingCountryEncrypted} is null
			)
		)`;
		const hasCoveringJob = sql`exists (
			select 1 from ${jobs}
			where ${jobs.providerBookingId} = ${bookings.id}
			and (
				${jobs.status} in ('pending', 'running', 'retrying')
				or ${jobs.updatedAt} >= (
					select max(${guests.updatedAt}) from ${guests}
					where ${guests.providerBookingId} = ${bookings.id}
				)
			)
		)`;

		const candidates = await this.#db
			.select({ id: bookings.id })
			.from(bookings)
			.where(
				and(
					eq(bookings.provider, this.#provider),
					inArray(bookings.normalizedStatus, ["confirmed", "completed"]),
					or(
						sql`${bookings.stayEndsAt} is null`,
						sql`${bookings.stayEndsAt} >= ${lookbackStart}`,
					),
					hasGuests,
					sql`not ${hasIncompleteGuest}`,
					sql`not ${hasCoveringJob}`,
				),
			)
			.limit(limit);

		let enqueued = 0;
		for (const candidate of candidates) {
			// The partial unique index on active jobs makes a concurrent-sweep
			// duplicate a constraint violation; treat it as "already enqueued".
			try {
				await this.#db.insert(guestSubmissionJobTable).values({
					id: crypto.randomUUID(),
					maxAttempts: this.#maxAttempts,
					nextRunAt: now,
					providerBookingId: candidate.id,
					status: "pending",
				});
				enqueued += 1;
			} catch (error) {
				if (!isUniqueViolation(error)) {
					throw error;
				}
			}
		}

		return { enqueued };
	}

	/** Claims and executes due jobs, applying the retry/backoff policy. */
	async processDueJobs(limit = 20): Promise<GuestSubmissionProcessSummary> {
		const now = this.#now();
		const summary: GuestSubmissionProcessSummary = {
			failed: 0,
			notConfigured: 0,
			processed: 0,
			retried: 0,
			skipped: 0,
			succeeded: 0,
		};

		const due = await this.#db
			.select({ id: guestSubmissionJobTable.id })
			.from(guestSubmissionJobTable)
			.where(
				and(
					inArray(guestSubmissionJobTable.status, ["pending", "retrying"]),
					or(
						sql`${guestSubmissionJobTable.nextRunAt} is null`,
						lte(guestSubmissionJobTable.nextRunAt, now),
					),
				),
			)
			.orderBy(asc(guestSubmissionJobTable.nextRunAt))
			.limit(limit);

		for (const { id } of due) {
			const claimed = await this.#claimJob(id);
			if (!claimed) {
				summary.skipped += 1;
				continue;
			}
			summary.processed += 1;
			await this.#executeJob(claimed, summary);
		}

		return summary;
	}

	async #claimJob(jobId: string) {
		const now = this.#now();
		const rows = await this.#db
			.update(guestSubmissionJobTable)
			.set({ startedAt: now, status: "running", updatedAt: now })
			.where(
				and(
					eq(guestSubmissionJobTable.id, jobId),
					inArray(guestSubmissionJobTable.status, ["pending", "retrying"]),
				),
			)
			.returning({
				attemptCount: guestSubmissionJobTable.attemptCount,
				id: guestSubmissionJobTable.id,
				maxAttempts: guestSubmissionJobTable.maxAttempts,
				providerBookingId: guestSubmissionJobTable.providerBookingId,
			});
		return rows[0] ?? null;
	}

	async #executeJob(
		job: {
			attemptCount: number;
			id: string;
			maxAttempts: number;
			providerBookingId: string;
		},
		summary: GuestSubmissionProcessSummary,
	): Promise<void> {
		const booking = await this.#loadBooking(job.providerBookingId);
		if (!booking) {
			await this.#finishJob(job.id, "canceled", "provider booking not found");
			summary.failed += 1;
			return;
		}
		if (
			booking.normalizedStatus !== "confirmed" &&
			booking.normalizedStatus !== "completed"
		) {
			await this.#finishJob(job.id, "canceled", "booking no longer confirmed");
			summary.failed += 1;
			return;
		}

		const client = this.#resolveHostkitClient(booking.hostifyListingId);
		if (!client) {
			// Not an attempt: the property simply has no Hostkit key yet. Keep the
			// job alive on a slow cadence so provisioning the key picks it up.
			await this.#releaseJob(
				job.id,
				UNCONFIGURED_RETRY_DELAY_MS,
				"hostkit key not configured for listing",
			);
			summary.notConfigured += 1;
			return;
		}

		const rcode = await this.#resolveRcode(booking);
		if (!rcode) {
			await this.#recordFailure(
				job,
				summary,
				"transient",
				"reservation code unavailable",
			);
			return;
		}

		const guests = await this.#loadGuests(job.providerBookingId);
		if (guests.length === 0) {
			await this.#finishJob(job.id, "canceled", "booking has no guest roster");
			summary.failed += 1;
			return;
		}

		const payloads = [];
		for (const guest of guests) {
			const built = buildHostkitGuest(guest, {
				arrival: booking.checkIn,
				departure: booking.checkOut,
				rcode,
			});
			if (built.kind === "incomplete") {
				await this.#finishJob(
					job.id,
					"failed",
					`guest slot ${guest.position + 1} incomplete: ${built.missing.join(", ")}`,
				);
				summary.failed += 1;
				return;
			}
			payloads.push(built.guest);
		}

		try {
			// Full re-sync per run: clearing first makes the addGuest sequence
			// idempotent across retries and roster edits.
			await client.guests.removeAll({ rcode });
			for (const payload of payloads) {
				await client.guests.add(payload);
			}
			await client.siba.validate({ rcode });
			if (this.#sendSiba) {
				await client.siba.send({ rcode });
			}
		} catch (error) {
			const kind = classifyGuestSubmissionError(error);
			if (kind === "permanent") {
				await this.#finishJob(job.id, "failed", describeError(error));
				summary.failed += 1;
				return;
			}
			await this.#recordFailure(job, summary, kind, describeError(error));
			return;
		}

		const now = this.#now();
		await this.#db
			.update(guestSubmissionJobTable)
			.set({
				attemptCount: job.attemptCount + 1,
				completedAt: now,
				externalResultReference: this.#sendSiba
					? "siba_sent"
					: "siba_validated",
				nextRunAt: null,
				redactedErrorText: null,
				status: "succeeded",
				updatedAt: now,
			})
			.where(eq(guestSubmissionJobTable.id, job.id));
		summary.succeeded += 1;
	}

	async #recordFailure(
		job: { attemptCount: number; id: string; maxAttempts: number },
		summary: GuestSubmissionProcessSummary,
		kind: "awaiting_provider" | "transient",
		message: string,
	): Promise<void> {
		const attemptCount = job.attemptCount + 1;
		const now = this.#now();
		if (attemptCount >= job.maxAttempts) {
			await this.#finishJob(
				job.id,
				"failed",
				`retries exhausted (${kind}): ${message}`,
				attemptCount,
			);
			summary.failed += 1;
			return;
		}

		await this.#db
			.update(guestSubmissionJobTable)
			.set({
				attemptCount,
				nextRunAt: new Date(
					now.getTime() + nextGuestSubmissionDelayMs(attemptCount),
				),
				redactedErrorText: `${kind}: ${message}`,
				status: "retrying",
				updatedAt: now,
			})
			.where(eq(guestSubmissionJobTable.id, job.id));
		summary.retried += 1;
	}

	/** Returns a running job to the queue without consuming an attempt. */
	async #releaseJob(
		jobId: string,
		delayMs: number,
		message: string,
	): Promise<void> {
		const now = this.#now();
		await this.#db
			.update(guestSubmissionJobTable)
			.set({
				nextRunAt: new Date(now.getTime() + delayMs),
				redactedErrorText: message,
				status: "pending",
				updatedAt: now,
			})
			.where(eq(guestSubmissionJobTable.id, jobId));
	}

	async #finishJob(
		jobId: string,
		status: Extract<GuestSubmissionJobStatus, "canceled" | "failed">,
		message: string,
		attemptCount?: number,
	): Promise<void> {
		const now = this.#now();
		await this.#db
			.update(guestSubmissionJobTable)
			.set({
				...(attemptCount === undefined ? {} : { attemptCount }),
				completedAt: now,
				nextRunAt: null,
				redactedErrorText: message,
				status,
				updatedAt: now,
			})
			.where(eq(guestSubmissionJobTable.id, jobId));
	}

	async #loadBooking(providerBookingId: string): Promise<JobBookingRow | null> {
		const rows = await this.#db
			.select({
				checkIn: accommodationItemDetailTable.checkIn,
				checkOut: accommodationItemDetailTable.checkOut,
				hostifyListingId: accommodationItemDetailTable.hostifyListingId,
				normalizedStatus: providerBookingTable.normalizedStatus,
				providerBookingId: providerBookingTable.id,
				providerReservationId: providerBookingTable.providerReservationId,
				rawOperationalPayload: providerBookingTable.rawOperationalPayload,
			})
			.from(providerBookingTable)
			.innerJoin(
				accommodationItemDetailTable,
				eq(
					accommodationItemDetailTable.orderItemId,
					providerBookingTable.orderItemId,
				),
			)
			.where(eq(providerBookingTable.id, providerBookingId))
			.limit(1);
		return rows[0] ?? null;
	}

	async #resolveRcode(booking: JobBookingRow): Promise<string | null> {
		const fromPayload = booking.rawOperationalPayload?.confirmation_code;
		if (typeof fromPayload === "string" && fromPayload.trim()) {
			return fromPayload.trim();
		}
		if (this.#resolveReservationCode && booking.providerReservationId) {
			return this.#resolveReservationCode(booking.providerReservationId);
		}
		return null;
	}

	async #loadGuests(
		providerBookingId: string,
	): Promise<GuestSubmissionGuest[]> {
		const rows = await this.#db
			.select({
				dateOfBirthEncrypted: bookingGuestTable.dateOfBirthEncrypted,
				documentIssuingCountryEncrypted:
					bookingGuestTable.documentIssuingCountryEncrypted,
				documentNumberEncrypted: bookingGuestTable.documentNumberEncrypted,
				documentTypeEncrypted: bookingGuestTable.documentTypeEncrypted,
				firstNameEncrypted: bookingGuestTable.firstNameEncrypted,
				lastNameEncrypted: bookingGuestTable.lastNameEncrypted,
				nationalityEncrypted: bookingGuestTable.nationalityEncrypted,
				position: bookingGuestTable.position,
				residenceCountryEncrypted: bookingGuestTable.residenceCountryEncrypted,
			})
			.from(bookingGuestTable)
			.where(eq(bookingGuestTable.providerBookingId, providerBookingId))
			.orderBy(asc(bookingGuestTable.position));

		return rows.map((row) => ({
			dateOfBirth: decryptGuestField(row.dateOfBirthEncrypted),
			documentIssuingCountry: decryptGuestField(
				row.documentIssuingCountryEncrypted,
			),
			documentNumber: decryptGuestField(row.documentNumberEncrypted),
			documentType: decryptGuestField(row.documentTypeEncrypted),
			firstName: decryptGuestField(row.firstNameEncrypted),
			lastName: decryptGuestField(row.lastNameEncrypted),
			nationality: decryptGuestField(row.nationalityEncrypted),
			position: row.position,
			residenceCountry: decryptGuestField(row.residenceCountryEncrypted),
		}));
	}
}

function decryptGuestField(value: Buffer | Uint8Array | null): string | null {
	return value ? decryptIdentityField(value) : null;
}

/** PII-safe error text for the job row: provider/message only, key scrubbed. */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		const detail =
			"providerMessage" in error &&
			typeof (error as { providerMessage?: unknown }).providerMessage ===
				"string"
				? `: ${(error as { providerMessage: string }).providerMessage}`
				: "";
		return redactHostkitText(`${error.name}${detail}`).slice(0, 500);
	}
	return "unknown error";
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}
