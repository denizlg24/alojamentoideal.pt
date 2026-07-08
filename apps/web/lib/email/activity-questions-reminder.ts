import {
	buildActivityQuestionsReminderEmail,
	getEmailSender,
} from "@workspace/auth";
import {
	normalizeActivityBookingQuestions,
	summarizeBookingQuestionsCompleteness,
} from "@workspace/core/activities";
import { generateMemberToken } from "@workspace/core/commerce";
import type {
	ActivityQuestionsReminderFacts,
	ActivityQuestionsReminderOutcome,
} from "@workspace/core/compliance";
import { createBokunClientFromEnv } from "@workspace/core/integrations/bokun";
import { commerceService } from "@/lib/api/commerce";
import { parseOrderActivityLiveBooking } from "@/lib/order/activity";
import { orderHubUrl } from "./order-url";

function formatDate(value: string): string {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		year: "numeric",
	}).format(date);
}

/**
 * Live-checks the booking's required provider questions and emails a reminder
 * when any is still unanswered. Returns `complete` (stop reminding) when the
 * questions are all answered or the booking can never be checked; throws on
 * provider/transport failures so the dispatcher retries on its failure cadence.
 */
export async function sendActivityQuestionsReminderEmail(
	facts: ActivityQuestionsReminderFacts,
): Promise<ActivityQuestionsReminderOutcome> {
	if (!facts.email || !facts.productConfirmationCode) {
		return "complete";
	}

	const bokun = createBokunClientFromEnv();
	const live = parseOrderActivityLiveBooking(
		await bokun.v1.booking.getActivityBooking(facts.productConfirmationCode),
	);
	if (!live.parentBookingId) {
		throw new Error(
			`Activity booking ${facts.productConfirmationCode} did not expose a parent booking id.`,
		);
	}

	const snapshot = normalizeActivityBookingQuestions(
		await bokun.v1.question.getBookingQuestions(live.parentBookingId),
	);
	const { missingRequired } = summarizeBookingQuestionsCompleteness(snapshot);
	if (missingRequired === 0) {
		return "complete";
	}

	const token = generateMemberToken();
	await (await commerceService()).activateOwnerAccessToken(
		facts.orderId,
		facts.email,
		token,
	);

	await getEmailSender().send({
		to: facts.email,
		...buildActivityQuestionsReminderEmail({
			activityDate: formatDate(facts.activityDate),
			activityTitle: facts.activityTitle,
			manageUrl: orderHubUrl(facts.publicReference, token),
			missingQuestionCount: missingRequired,
			orderNumber: facts.publicReference,
		}),
	});
	return "sent";
}
