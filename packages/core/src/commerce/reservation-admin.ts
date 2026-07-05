import {
	type Database,
	type ProviderBookingStatus,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type {
	HostifyClient,
	HostifyUpdateReservationInput,
} from "../integrations/hostify";
import { trackEvent } from "../observability";
import { CommerceError } from "./errors";

/**
 * Hostify statuses an operator can move a single reservation to. `pending` is
 * excluded (it is only ever the initial hold state) and mirrors Hostify's own
 * update contract.
 */
export type HostifyReservationStatusTarget =
	| "accepted"
	| "cancelled_by_guest"
	| "cancelled_by_host"
	| "denied"
	| "no_show";

export interface UpdateReservationStatusInput {
	bookingId: string;
	orderId: string;
	status: HostifyReservationStatusTarget;
}

export interface UpdateReservationDetailsInput {
	bookingId: string;
	/** Check-in date, YYYY-MM-DD. */
	checkIn?: string;
	/** Check-out date, YYYY-MM-DD. */
	checkOut?: string;
	guests?: number;
	orderId: string;
}

export interface ReservationAdminResult {
	bookingId: string;
	normalizedStatus: ProviderBookingStatus;
	providerStatus: string | null;
}

export interface ReservationAdminServiceOptions {
	db: Database;
	/**
	 * Hostify client, or null in the dry-run mode (HOSTIFY_BOOKINGS_ENABLED=false)
	 * where local booking state is synced without touching the provider.
	 */
	hostify: HostifyClient | null;
	now?: () => Date;
}

/** Maps a Hostify reservation status to our normalized provider-booking status. */
export function normalizeHostifyReservationStatus(
	status: string,
): ProviderBookingStatus {
	switch (status) {
		case "accepted":
			return "confirmed";
		case "denied":
			return "failed";
		case "cancelled_by_guest":
		case "cancelled_by_host":
			return "cancelled";
		case "no_show":
			return "completed";
		default:
			return "pending";
	}
}

/**
 * Operator-driven single-reservation management: status transitions and
 * guest-count/date edits against Hostify, kept in sync with the local
 * `provider_bookings` row. This is deliberately decoupled from money — a
 * cancellation here does not refund; the operator issues any refund separately
 * through the refund panel.
 */
export class ReservationAdminService {
	readonly #db: Database;
	readonly #hostify: HostifyClient | null;
	readonly #now: () => Date;

	constructor(options: ReservationAdminServiceOptions) {
		this.#db = options.db;
		this.#hostify = options.hostify;
		this.#now = options.now ?? (() => new Date());
	}

	async updateReservationStatus(
		input: UpdateReservationStatusInput,
	): Promise<ReservationAdminResult> {
		const booking = await this.#loadBooking(input.orderId, input.bookingId);

		let providerStatus: string = input.status;
		if (this.#hostify) {
			if (!booking.providerReservationId) {
				throw new CommerceError(
					"reservation_unavailable",
					"this booking has no Hostify reservation to update",
					422,
				);
			}
			const response = await this.#hostify.reservations.update(
				booking.providerReservationId,
				{ status: input.status },
			);
			providerStatus = response.update_data?.status ?? input.status;
		}

		const normalizedStatus = normalizeHostifyReservationStatus(providerStatus);
		await this.#syncBooking(booking.id, { normalizedStatus, providerStatus });

		trackEvent({
			metadata: {
				bookingId: booking.id,
				orderId: input.orderId,
				status: input.status,
			},
			name: "reservation_status_updated",
			provider: "hostify",
			severity: "info",
			type: "integration",
		});

		return { bookingId: booking.id, normalizedStatus, providerStatus };
	}

	async updateReservationDetails(
		input: UpdateReservationDetailsInput,
	): Promise<ReservationAdminResult> {
		const booking = await this.#loadBooking(input.orderId, input.bookingId);

		const update: HostifyUpdateReservationInput = {};
		if (input.checkIn) {
			update.check_in = input.checkIn;
		}
		if (input.checkOut) {
			update.check_out = input.checkOut;
		}
		if (input.guests !== undefined) {
			update.guests = input.guests;
		}
		if (Object.keys(update).length === 0) {
			throw new CommerceError(
				"invalid_request",
				"no reservation changes were provided",
				400,
			);
		}

		if (this.#hostify) {
			if (!booking.providerReservationId) {
				throw new CommerceError(
					"reservation_unavailable",
					"this booking has no Hostify reservation to update",
					422,
				);
			}
			await this.#hostify.reservations.update(
				booking.providerReservationId,
				update,
			);
		}

		const now = this.#now();
		const patch: Partial<typeof providerBookingTable.$inferInsert> = {
			providerUpdatedAt: now,
			updatedAt: now,
		};
		if (input.checkIn) {
			patch.stayStartsAt = new Date(input.checkIn);
		}
		if (input.checkOut) {
			patch.stayEndsAt = new Date(input.checkOut);
		}
		await this.#db
			.update(providerBookingTable)
			.set(patch)
			.where(eq(providerBookingTable.id, booking.id));

		trackEvent({
			metadata: {
				bookingId: booking.id,
				fields: Object.keys(update),
				orderId: input.orderId,
			},
			name: "reservation_details_updated",
			provider: "hostify",
			severity: "info",
			type: "integration",
		});

		return {
			bookingId: booking.id,
			normalizedStatus: booking.normalizedStatus,
			providerStatus: booking.providerStatus,
		};
	}

	async #loadBooking(orderId: string, bookingId: string) {
		const [row] = await this.#db
			.select({
				id: providerBookingTable.id,
				normalizedStatus: providerBookingTable.normalizedStatus,
				providerReservationId: providerBookingTable.providerReservationId,
				providerStatus: providerBookingTable.providerStatus,
			})
			.from(providerBookingTable)
			.where(
				and(
					eq(providerBookingTable.id, bookingId),
					eq(providerBookingTable.orderId, orderId),
				),
			)
			.limit(1);
		if (!row) {
			throw new CommerceError(
				"item_not_found",
				"reservation not found on this order",
				404,
			);
		}
		return row;
	}

	async #syncBooking(
		bookingId: string,
		values: { normalizedStatus: ProviderBookingStatus; providerStatus: string },
	): Promise<void> {
		const now = this.#now();
		await this.#db
			.update(providerBookingTable)
			.set({
				normalizedStatus: values.normalizedStatus,
				providerStatus: values.providerStatus,
				providerUpdatedAt: now,
				updatedAt: now,
			})
			.where(eq(providerBookingTable.id, bookingId));
	}
}
