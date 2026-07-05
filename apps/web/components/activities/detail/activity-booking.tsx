import type { ActivityDetail } from "@workspace/core/activities";
import { addDays, format } from "date-fns";
import { connection } from "next/server";
import { AVAILABILITY_WINDOW_DAYS } from "@/lib/activities/constants";
import { loadActivityAvailability } from "@/lib/activities/source";
import { ActivityBookingWidget } from "./activity-booking-widget";

/**
 * Server slot that fetches the live departure window once and hands it to the
 * client widget. Rendered inside a Suspense boundary so availability streams in
 * while the (cached, static) rest of the detail page paints immediately.
 */
export async function ActivityBooking({
	activity,
	currency,
}: {
	activity: ActivityDetail;
	currency: string;
}) {
	await connection();
	const today = new Date();
	const calendar = await loadActivityAvailability(activity.id, {
		start: format(today, "yyyy-MM-dd"),
		end: format(addDays(today, AVAILABILITY_WINDOW_DAYS), "yyyy-MM-dd"),
		currency,
	});

	return (
		<ActivityBookingWidget
			activity={activity}
			calendar={calendar}
			currency={currency}
		/>
	);
}
