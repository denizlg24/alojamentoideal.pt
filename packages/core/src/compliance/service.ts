import {
	accommodationItemDetail as accommodationItemDetailTable,
	activityItemDetail as activityItemDetailTable,
	bookingGuest as bookingGuestTable,
	type Database,
	type GuestSubmissionJobStatus,
	guestSubmissionJob as guestSubmissionJobTable,
	orderContact as orderContactTable,
	orderItem as orderItemTable,
	order as orderTable,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import { decryptIdentityField } from "../account/identity-encryption";
import type { HostkitClient } from "../integrations/hostkit";
import { redactHostkitText } from "../integrations/hostkit";
import {
	type GuestInfoReminderFacts,
	nextGuestInfoReminderAt,
} from "./guest-reminder";
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

/** Lease window for a running SIBA guest-submission job. */
const GUEST_SUBMISSION_JOB_LEASE_MS = 30 * 60 * 1000;

/** Temporary lease for a reminder email send claim. */
const GUEST_REMINDER_EMAIL_CLAIM_MS = 15 * 60 * 1000;

/** Transport failure retry cadence; successful reminders use reverse backoff. */
const GUEST_REMINDER_EMAIL_FAILURE_DELAY_MS = 60 * 60 * 1000;

export interface GuestComplianceServiceOptions {
	db: Database;
	maxAttempts?: number;
	now?: () => Date;
	/** Provider name whose bookings are covered by Hostkit (Hostify). */
	provider?: string;
	/** Returns the property-scoped Hostkit client, or null when not set up. */
	resolveHostkitClient: (
		listingId: string,
	) => HostkitClient | null | Promise<HostkitClient | null>;
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

export interface GuestInfoReminderSummary {
	reminderEmailsFailed: number;
	reminderEmailsSent: number;
	reminderEmailsSkipped: number;
}

/**
 * One activity booking whose required provider questions may still be
 * unanswered. Whether they actually are is only known provider-side, so the
 * dispatch callback performs the live check and reports the outcome.
 */
export interface ActivityQuestionsReminderFacts {
	/** Local activity date, `YYYY-MM-DD`. */
	activityDate: string;
	activityTitle: string;
	email: string;
	orderId: string;
	orderItemId: string;
	/** Provider code of the product booking; keys the live questions read. */
	productConfirmationCode: string | null;
	publicReference: string;
}

/**
 * `sent`: a reminder email went out (schedules the next reverse-backoff send).
 * `complete`: every required question is answered (stops reminding for good).
 */
export type ActivityQuestionsReminderOutcome = "complete" | "sent";

export interface ActivityQuestionsReminderSummary {
	activityQuestionRemindersDismissed: number;
	activityQuestionRemindersFailed: number;
	activityQuestionRemindersSent: number;
	activityQuestionRemindersSkipped: number;
}

export type GuestSubmissionRunSummary = ActivityQuestionsReminderSummary &
	GuestSubmissionProcessSummary &
	GuestSubmissionSweepSummary &
	GuestInfoReminderSummary;

export interface GuestComplianceRunOptions {
	onActivityQuestionsReminder?: (
		facts: ActivityQuestionsReminderFacts,
	) => Promise<ActivityQuestionsReminderOutcome>;
	onGuestInfoReminder?: (facts: GuestInfoReminderFacts) => Promise<void>;
}

interface JobBookingRow {
	checkIn: string;
	checkOut: string;
	hostifyListingId: string;
	normalizedStatus: string;
	providerBookingId: string;
	providerReservationId: string | null;
	rawOperationalPayload: Record<string, unknown> | null;
}

interface GuestReminderDispatchTarget {
	facts: GuestInfoReminderFacts;
	reminderEmailCount: number;
	stayStartsAt: Date;
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
	async run(
		limit = 20,
		options: GuestComplianceRunOptions = {},
	): Promise<GuestSubmissionRunSummary> {
		const sweep = await this.sweepEligibleBookings(limit);
		const process = await this.processDueJobs(limit);
		const reminders = await this.dispatchDueGuestInfoReminders(
			limit,
			options.onGuestInfoReminder,
		);
		const activityReminders = await this.dispatchDueActivityQuestionReminders(
			limit,
			options.onActivityQuestionsReminder,
		);
		return { ...sweep, ...process, ...reminders, ...activityReminders };
	}

	/**
	 * Enqueues a submission job for every confirmed booking whose roster is
	 * complete and not yet covered: no active non-stale job, and no terminal job
	 * newer than the roster's last change (so editing a guest after a successful
	 * submission re-syncs it).
	 */
	async sweepEligibleBookings(
		limit = 20,
	): Promise<GuestSubmissionSweepSummary> {
		const now = this.#now();
		const staleRunningBefore = new Date(
			now.getTime() - GUEST_SUBMISSION_JOB_LEASE_MS,
		);
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
				${jobs.status} in ('pending', 'retrying')
				or (
					${jobs.status} = 'running'
					and (
						(${jobs.nextRunAt} is not null and ${jobs.nextRunAt} > ${now})
						or (
							${jobs.nextRunAt} is null
							and coalesce(${jobs.startedAt}, ${jobs.updatedAt}) > ${staleRunningBefore}
						)
					)
				)
				or (
					${jobs.status} in ('succeeded', 'failed', 'canceled')
					and ${jobs.updatedAt} >= (
						select max(${guests.updatedAt}) from ${guests}
						where ${guests.providerBookingId} = ${bookings.id}
					)
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
			.where(dueGuestSubmissionJobCondition(now))
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

	/**
	 * Sends guest-info reminders for confirmed stays whose roster still needs
	 * user action. The email transport stays outside core; this method only claims
	 * due bookings and records the next reverse-backoff send time.
	 */
	async dispatchDueGuestInfoReminders(
		limit = 20,
		onReminder?: (facts: GuestInfoReminderFacts) => Promise<void>,
	): Promise<GuestInfoReminderSummary> {
		const summary = emptyGuestInfoReminderSummary();
		if (!onReminder) {
			return summary;
		}

		const now = this.#now();
		const due = await this.#db
			.select({ id: providerBookingTable.id })
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.where(
				and(
					eq(providerBookingTable.provider, this.#provider),
					eq(orderTable.status, "confirmed"),
					inArray(providerBookingTable.normalizedStatus, [
						"confirmed",
						"completed",
					]),
					sql`${providerBookingTable.guestReminderEmailNextAt} is not null`,
					lte(providerBookingTable.guestReminderEmailNextAt, now),
					gt(providerBookingTable.stayStartsAt, now),
					hasGuestNeedingReminder(),
				),
			)
			.orderBy(asc(providerBookingTable.guestReminderEmailNextAt))
			.limit(limit);

		for (const { id } of due) {
			const claimed = await this.#claimGuestInfoReminder(id, now);
			if (!claimed) {
				summary.reminderEmailsSkipped += 1;
				continue;
			}

			const target = await this.#loadGuestInfoReminderTarget(id, now);
			if (!target) {
				await this.#dismissGuestInfoReminder(id, now);
				summary.reminderEmailsSkipped += 1;
				continue;
			}

			try {
				await onReminder(target.facts);
				await this.#markGuestInfoReminderSent(id, target, this.#now());
				summary.reminderEmailsSent += 1;
			} catch (error) {
				await this.#recordGuestInfoReminderFailure(
					id,
					describeError(error),
					this.#now(),
				);
				summary.reminderEmailsFailed += 1;
			}
		}

		return summary;
	}

	/**
	 * Sends reminders for confirmed activity bookings whose required provider
	 * questions may still be unanswered. Shares the guest-info reminder cadence
	 * and per-booking reminder columns; whether required answers are actually
	 * missing is only known provider-side, so the callback does the live check
	 * and reports back: `complete` stops the reminders, `sent` schedules the
	 * next reverse-backoff send, a throw retries on the failure cadence.
	 */
	async dispatchDueActivityQuestionReminders(
		limit = 20,
		onReminder?: (
			facts: ActivityQuestionsReminderFacts,
		) => Promise<ActivityQuestionsReminderOutcome>,
	): Promise<ActivityQuestionsReminderSummary> {
		const summary = emptyActivityQuestionsReminderSummary();
		if (!onReminder) {
			return summary;
		}

		const now = this.#now();
		const due = await this.#db
			.select({ id: providerBookingTable.id })
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.where(
				and(
					eq(orderItemTable.type, "activity"),
					eq(orderTable.status, "confirmed"),
					inArray(providerBookingTable.normalizedStatus, [
						"confirmed",
						"completed",
					]),
					sql`${providerBookingTable.guestReminderEmailNextAt} is not null`,
					lte(providerBookingTable.guestReminderEmailNextAt, now),
					gt(providerBookingTable.stayStartsAt, now),
				),
			)
			.orderBy(asc(providerBookingTable.guestReminderEmailNextAt))
			.limit(limit);

		for (const { id } of due) {
			const claimed = await this.#claimGuestInfoReminder(id, now);
			if (!claimed) {
				summary.activityQuestionRemindersSkipped += 1;
				continue;
			}

			const target = await this.#loadActivityQuestionsReminderTarget(id, now);
			if (!target) {
				await this.#dismissGuestInfoReminder(id, now);
				summary.activityQuestionRemindersSkipped += 1;
				continue;
			}

			try {
				const outcome = await onReminder(target.facts);
				if (outcome === "complete") {
					await this.#dismissGuestInfoReminder(id, this.#now());
					summary.activityQuestionRemindersDismissed += 1;
				} else {
					await this.#markGuestInfoReminderSent(id, target, this.#now());
					summary.activityQuestionRemindersSent += 1;
				}
			} catch (error) {
				await this.#recordGuestInfoReminderFailure(
					id,
					describeError(error),
					this.#now(),
				);
				summary.activityQuestionRemindersFailed += 1;
			}
		}

		return summary;
	}

	async #loadActivityQuestionsReminderTarget(
		providerBookingId: string,
		now: Date,
	): Promise<{
		facts: ActivityQuestionsReminderFacts;
		reminderEmailCount: number;
		stayStartsAt: Date;
	} | null> {
		const [row] = await this.#db
			.select({
				activityDate: activityItemDetailTable.activityDate,
				activityTitle: orderItemTable.titleSnapshot,
				email: orderContactTable.email,
				orderId: orderTable.id,
				orderItemId: orderItemTable.id,
				productConfirmationCode: providerBookingTable.providerTransactionId,
				publicReference: orderTable.publicReference,
				reminderEmailCount: providerBookingTable.guestReminderEmailCount,
				stayStartsAt: providerBookingTable.stayStartsAt,
			})
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.innerJoin(
				orderContactTable,
				eq(orderContactTable.orderId, orderTable.id),
			)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(
				activityItemDetailTable,
				eq(
					activityItemDetailTable.orderItemId,
					providerBookingTable.orderItemId,
				),
			)
			.where(
				and(
					eq(providerBookingTable.id, providerBookingId),
					eq(orderTable.status, "confirmed"),
					inArray(providerBookingTable.normalizedStatus, [
						"confirmed",
						"completed",
					]),
				),
			)
			.limit(1);

		if (!row?.stayStartsAt || row.stayStartsAt.getTime() <= now.getTime()) {
			return null;
		}

		return {
			facts: {
				activityDate: row.activityDate,
				activityTitle: row.activityTitle,
				email: row.email,
				orderId: row.orderId,
				orderItemId: row.orderItemId,
				productConfirmationCode: row.productConfirmationCode,
				publicReference: row.publicReference,
			},
			reminderEmailCount: row.reminderEmailCount,
			stayStartsAt: row.stayStartsAt,
		};
	}

	async #claimGuestInfoReminder(
		providerBookingId: string,
		now: Date,
	): Promise<boolean> {
		const claimExpiresAt = new Date(
			now.getTime() + GUEST_REMINDER_EMAIL_CLAIM_MS,
		);
		const [updated] = await this.#db
			.update(providerBookingTable)
			.set({ guestReminderEmailNextAt: claimExpiresAt, updatedAt: now })
			.where(
				and(
					eq(providerBookingTable.id, providerBookingId),
					sql`${providerBookingTable.guestReminderEmailNextAt} is not null`,
					lte(providerBookingTable.guestReminderEmailNextAt, now),
				),
			)
			.returning({ id: providerBookingTable.id });
		return Boolean(updated);
	}

	async #loadGuestInfoReminderTarget(
		providerBookingId: string,
		now: Date,
	): Promise<GuestReminderDispatchTarget | null> {
		const totalGuestCount = sql<number>`(
			select count(*)::int from ${bookingGuestTable}
			where ${bookingGuestTable.providerBookingId} = ${providerBookingTable.id}
		)`;
		const missingGuestCount = sql<number>`(
			select count(*)::int from ${bookingGuestTable}
			where ${bookingGuestTable.providerBookingId} = ${providerBookingTable.id}
			and ${guestNeedsReminderCondition()}
		)`;

		const [row] = await this.#db
			.select({
				accommodationTitle: orderItemTable.titleSnapshot,
				checkIn: accommodationItemDetailTable.checkIn,
				checkOut: accommodationItemDetailTable.checkOut,
				email: orderContactTable.email,
				missingGuestCount,
				orderId: orderTable.id,
				publicReference: orderTable.publicReference,
				reminderEmailCount: providerBookingTable.guestReminderEmailCount,
				stayStartsAt: providerBookingTable.stayStartsAt,
				totalGuestCount,
			})
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.innerJoin(
				orderContactTable,
				eq(orderContactTable.orderId, orderTable.id),
			)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, providerBookingTable.orderItemId),
			)
			.innerJoin(
				accommodationItemDetailTable,
				eq(
					accommodationItemDetailTable.orderItemId,
					providerBookingTable.orderItemId,
				),
			)
			.where(
				and(
					eq(providerBookingTable.id, providerBookingId),
					eq(providerBookingTable.provider, this.#provider),
					eq(orderTable.status, "confirmed"),
					inArray(providerBookingTable.normalizedStatus, [
						"confirmed",
						"completed",
					]),
				),
			)
			.limit(1);

		if (!row?.stayStartsAt || row.stayStartsAt.getTime() <= now.getTime()) {
			return null;
		}

		const missingCount = Number(row.missingGuestCount);
		const totalCount = Number(row.totalGuestCount);
		if (missingCount <= 0 || totalCount <= 0) {
			return null;
		}

		return {
			facts: {
				accommodationTitle: row.accommodationTitle,
				checkIn: row.checkIn,
				checkOut: row.checkOut,
				email: row.email,
				missingGuestCount: missingCount,
				orderId: row.orderId,
				publicReference: row.publicReference,
				totalGuestCount: totalCount,
			},
			reminderEmailCount: row.reminderEmailCount,
			stayStartsAt: row.stayStartsAt,
		};
	}

	async #markGuestInfoReminderSent(
		providerBookingId: string,
		target: { reminderEmailCount: number; stayStartsAt: Date },
		now: Date,
	): Promise<void> {
		await this.#db
			.update(providerBookingTable)
			.set({
				guestReminderEmailCount: target.reminderEmailCount + 1,
				guestReminderEmailLastError: null,
				guestReminderEmailLastSentAt: now,
				guestReminderEmailNextAt: nextGuestInfoReminderAt(
					now,
					target.stayStartsAt,
				),
				updatedAt: now,
			})
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	async #recordGuestInfoReminderFailure(
		providerBookingId: string,
		message: string,
		now: Date,
	): Promise<void> {
		await this.#db
			.update(providerBookingTable)
			.set({
				guestReminderEmailLastError: message.slice(0, 500),
				guestReminderEmailNextAt: new Date(
					now.getTime() + GUEST_REMINDER_EMAIL_FAILURE_DELAY_MS,
				),
				updatedAt: now,
			})
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	async #dismissGuestInfoReminder(
		providerBookingId: string,
		now: Date,
	): Promise<void> {
		await this.#db
			.update(providerBookingTable)
			.set({ guestReminderEmailNextAt: null, updatedAt: now })
			.where(eq(providerBookingTable.id, providerBookingId));
	}

	async #claimJob(jobId: string) {
		const now = this.#now();
		const leaseExpiresAt = new Date(
			now.getTime() + GUEST_SUBMISSION_JOB_LEASE_MS,
		);
		const rows = await this.#db
			.update(guestSubmissionJobTable)
			.set({
				nextRunAt: leaseExpiresAt,
				startedAt: now,
				status: "running",
				updatedAt: now,
			})
			.where(
				and(
					eq(guestSubmissionJobTable.id, jobId),
					dueGuestSubmissionJobCondition(now),
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

		const client = await this.#resolveHostkitClient(booking.hostifyListingId);
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
			.update(bookingGuestTable)
			.set({ identityStatus: "verified", updatedAt: now })
			.where(
				and(
					eq(bookingGuestTable.providerBookingId, job.providerBookingId),
					eq(bookingGuestTable.identityStatus, "provided"),
				),
			);
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

function emptyGuestInfoReminderSummary(): GuestInfoReminderSummary {
	return {
		reminderEmailsFailed: 0,
		reminderEmailsSent: 0,
		reminderEmailsSkipped: 0,
	};
}

function emptyActivityQuestionsReminderSummary(): ActivityQuestionsReminderSummary {
	return {
		activityQuestionRemindersDismissed: 0,
		activityQuestionRemindersFailed: 0,
		activityQuestionRemindersSent: 0,
		activityQuestionRemindersSkipped: 0,
	};
}

function dueGuestSubmissionJobCondition(now: Date): SQL {
	const staleRunningBefore = new Date(
		now.getTime() - GUEST_SUBMISSION_JOB_LEASE_MS,
	);

	return sql`(
		(
			${guestSubmissionJobTable.status} in ('pending', 'retrying')
			and (
				${guestSubmissionJobTable.nextRunAt} is null
				or ${guestSubmissionJobTable.nextRunAt} <= ${now}
			)
		)
		or (
			${guestSubmissionJobTable.status} = 'running'
			and (
				(
					${guestSubmissionJobTable.nextRunAt} is not null
					and ${guestSubmissionJobTable.nextRunAt} <= ${now}
				)
				or (
					${guestSubmissionJobTable.nextRunAt} is null
					and coalesce(
						${guestSubmissionJobTable.startedAt},
						${guestSubmissionJobTable.updatedAt}
					) <= ${staleRunningBefore}
				)
			)
		)
	)`;
}

function hasGuestNeedingReminder(): SQL {
	return sql`exists (
		select 1 from ${bookingGuestTable}
		where ${bookingGuestTable.providerBookingId} = ${providerBookingTable.id}
		and ${guestNeedsReminderCondition()}
	)`;
}

function guestNeedsReminderCondition(): SQL {
	return sql`(
		${bookingGuestTable.identityStatus} in ('missing', 'requires_input', 'canceled')
		or (
			${bookingGuestTable.identityStatus} = 'provided'
			and (
				${bookingGuestTable.firstNameEncrypted} is null
				or ${bookingGuestTable.lastNameEncrypted} is null
				or ${bookingGuestTable.dateOfBirthEncrypted} is null
				or ${bookingGuestTable.nationalityEncrypted} is null
				or ${bookingGuestTable.residenceCountryEncrypted} is null
				or ${bookingGuestTable.documentNumberEncrypted} is null
				or ${bookingGuestTable.documentTypeEncrypted} is null
				or ${bookingGuestTable.documentIssuingCountryEncrypted} is null
			)
		)
	)`;
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
