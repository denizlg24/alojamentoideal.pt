import "server-only";

import {
	type ActivityBookingQuestionsSnapshot,
	type ActivityDetail,
	applyBookingQuestionAnswers,
	type BookingQuestionAnswerUpdate,
	type BookingQuestionsCompleteness,
	buildBookingQuestionsAnswerBody,
	normalizeActivityBookingQuestions,
	summarizeBookingQuestionsCompleteness,
} from "@workspace/core/activities";
import type { OrderDetail, OrderDetailItem } from "@workspace/core/commerce";
import {
	type BokunClient,
	createBokunClientFromEnv,
} from "@workspace/core/integrations/bokun";
import { logger } from "@workspace/core/observability";
import {
	getActivityCatalogScope,
	getCachedActivityDetail,
} from "@/lib/activities/source";
import { commerceService, resolveOrderAccessContext } from "@/lib/api/commerce";

let client: BokunClient | null = null;

function getBokunClient(): BokunClient {
	client ??= createBokunClientFromEnv();
	return client;
}

/** The live Bokun facts the order hub shows for one placed activity booking. */
export interface OrderActivityLiveBooking {
	/** Bokun's activity-booking id inside the parent booking. */
	bookingId: string | null;
	dropoffPlaceTitle: string | null;
	/** Numeric parent booking id; keys the questions and summary endpoints. */
	parentBookingId: string | null;
	pickupPlaceDescription: string | null;
	pickupPlaceRoomNumber: string | null;
	pickupPlaceTitle: string | null;
	pickupTime: string | null;
	startTime: string | null;
	status: string | null;
}

export interface OrderActivityQuestionsView {
	completeness: BookingQuestionsCompleteness;
	snapshot: ActivityBookingQuestionsSnapshot;
}

export interface OrderActivityView {
	experience: ActivityDetail | null;
	item: OrderDetailItem;
	live: OrderActivityLiveBooking | null;
	questions: OrderActivityQuestionsView | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number") {
		return String(value);
	}
	return null;
}

function placeTitle(value: unknown): string | null {
	const record = asRecord(value);
	return record ? asString(record.title) : null;
}

/** Lenient view over Bokun's activity-booking payload; absent fields go null. */
export function parseOrderActivityLiveBooking(
	raw: unknown,
): OrderActivityLiveBooking {
	const record = asRecord(raw);
	return {
		bookingId: asString(record?.bookingId),
		dropoffPlaceTitle: placeTitle(record?.dropoffPlace),
		parentBookingId: asString(record?.parentBookingId),
		pickupPlaceDescription: asString(record?.pickupPlaceDescription),
		pickupPlaceRoomNumber: asString(record?.pickupPlaceRoomNumber),
		pickupPlaceTitle: placeTitle(record?.pickupPlace),
		pickupTime: asString(record?.pickupTime),
		startTime: asString(record?.startTime),
		status: asString(record?.status),
	};
}

export function findOrderActivityItem(
	detail: OrderDetail,
	itemId: string,
): OrderDetailItem | null {
	const item = detail.items.find((entry) => entry.id === itemId);
	return item && item.type === "activity" && item.activity ? item : null;
}

export type ResolvedOrderActivityItem =
	| { ok: false; response: Response }
	| { ok: true; item: OrderDetailItem };

/**
 * Resolves the viewer's access to one activity order item for an API route.
 * `readOrderDetail` nulls the `activity` facts for non-owner viewers, so a
 * member (or an unknown item) uniformly resolves to a 404 — the item id stays
 * unenumerable, matching how order references behave.
 */
export async function resolveOrderActivityItemForRequest(
	request: Request,
	reference: string,
	itemId: string,
): Promise<ResolvedOrderActivityItem> {
	const accessContext = await resolveOrderAccessContext(request, reference);
	const service = await commerceService();
	const access = await service.resolveOrderAccess(reference, accessContext);
	const detail = await service.readOrderDetail(access);
	const item = findOrderActivityItem(detail, itemId);
	if (!item) {
		return {
			ok: false,
			response: Response.json(
				{ code: "not_found", error: "Order item not found." },
				{ status: 404 },
			),
		};
	}
	return { item, ok: true };
}

/** Base64 PDF of the activity ticket, or null when the booking has no code. */
export async function fetchOrderActivityTicket(
	item: OrderDetailItem,
): Promise<string | null> {
	const code = item.activity?.productConfirmationCode;
	if (!code) {
		return null;
	}
	return getBokunClient().v1.booking.getActivityTicket(code);
}

/**
 * Base64 PDF of the parent booking's summary (the guest-facing invoice, as in
 * the legacy app), or null when the booking has no code yet. The summary
 * endpoint is keyed by the numeric parent booking id, so the product booking
 * is read first to resolve it.
 */
export async function fetchOrderActivityInvoice(
	item: OrderDetailItem,
): Promise<string | null> {
	const code = item.activity?.productConfirmationCode;
	if (!code) {
		return null;
	}
	const bokun = getBokunClient();
	const live = parseOrderActivityLiveBooking(
		await bokun.v1.booking.getActivityBooking(code),
	);
	if (!live.parentBookingId) {
		return null;
	}
	return bokun.v1.booking.getSummary(live.parentBookingId);
}

export interface ActivityDocuments {
	/** Base64 PDF of the parent booking summary (guest-facing invoice). */
	invoice: string | null;
	/** Base64 PDF of the activity ticket. */
	ticket: string | null;
}

/**
 * Best-effort fetch of the ticket and invoice PDFs for one product booking.
 * Each document degrades to `null` on provider failure so callers (e.g. the
 * confirmation email) can proceed with whatever is available.
 */
export async function fetchActivityDocumentsByCode(
	productConfirmationCode: string,
): Promise<ActivityDocuments> {
	const bokun = getBokunClient();
	let ticket: string | null = null;
	let invoice: string | null = null;

	try {
		ticket = await bokun.v1.booking.getActivityTicket(productConfirmationCode);
	} catch (error) {
		logger.warn("failed to fetch activity ticket PDF", {
			error,
			productConfirmationCode,
		});
	}

	try {
		const live = parseOrderActivityLiveBooking(
			await bokun.v1.booking.getActivityBooking(productConfirmationCode),
		);
		if (live.parentBookingId) {
			invoice = await bokun.v1.booking.getSummary(live.parentBookingId);
		}
	} catch (error) {
		logger.warn("failed to fetch activity invoice PDF", {
			error,
			productConfirmationCode,
		});
	}

	return { invoice, ticket };
}

export type SubmitOrderActivityAnswersResult =
	| { status: "incomplete"; missingRequired: number }
	| { status: "ok" }
	| { status: "unavailable" };

/**
 * Applies edited answers on top of the provider's current questions and pushes
 * the merged set back to Bokun. Refuses (`incomplete`) when a required question
 * would end up blank, so an edit can never regress a completed booking.
 */
export async function submitOrderActivityAnswers(
	item: OrderDetailItem,
	updates: readonly BookingQuestionAnswerUpdate[],
): Promise<SubmitOrderActivityAnswersResult> {
	const code = item.activity?.productConfirmationCode;
	if (!code) {
		return { status: "unavailable" };
	}
	const bokun = getBokunClient();
	const live = parseOrderActivityLiveBooking(
		await bokun.v1.booking.getActivityBooking(code),
	);
	if (!live.parentBookingId) {
		return { status: "unavailable" };
	}
	const snapshot = normalizeActivityBookingQuestions(
		await bokun.v1.question.getBookingQuestions(live.parentBookingId),
	);
	const updated = applyBookingQuestionAnswers(snapshot, updates);
	const completeness = summarizeBookingQuestionsCompleteness(updated);
	if (completeness.missingRequired > 0) {
		return {
			missingRequired: completeness.missingRequired,
			status: "incomplete",
		};
	}
	await bokun.v1.question.answerBookingQuestions(
		live.parentBookingId,
		buildBookingQuestionsAnswerBody(updated),
	);
	return { status: "ok" };
}

/**
 * Loads the live provider facts for one activity order item: the Bokun booking
 * (status, pickup, start time) and its post-booking questions with the answers
 * on file. Provider failures degrade to `null` sections so the page still
 * renders the persisted facts.
 */
export async function loadOrderActivityView(
	item: OrderDetailItem,
): Promise<OrderActivityView> {
	const activity = item.activity;
	const experience = activity
		? await getCachedActivityDetail(
				activity.bokunActivityId,
				getActivityCatalogScope(),
			)
		: null;

	let live: OrderActivityLiveBooking | null = null;
	let questions: OrderActivityQuestionsView | null = null;

	if (activity?.productConfirmationCode) {
		try {
			const bokun = getBokunClient();
			const rawBooking = await bokun.v1.booking.getActivityBooking(
				activity.productConfirmationCode,
			);
			live = parseOrderActivityLiveBooking(rawBooking);
			if (live.parentBookingId) {
				const rawQuestions = await bokun.v1.question.getBookingQuestions(
					live.parentBookingId,
				);
				const snapshot = normalizeActivityBookingQuestions(rawQuestions);
				questions = {
					completeness: summarizeBookingQuestionsCompleteness(snapshot),
					snapshot,
				};
			}
		} catch (error) {
			logger.warn("failed to load live activity booking for order item", {
				error,
				orderItemId: item.id,
			});
		}
	}

	return { experience, item, live, questions };
}
