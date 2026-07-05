import { GuestComplianceService } from "@workspace/core/compliance";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { createHostkitClientForListingFromSettings } from "@workspace/core/integrations/hostkit";
import { getRuntimeSettings } from "@workspace/core/settings";
import { getDb } from "@workspace/db";

/**
 * Guest-registration compliance (Hostkit/SIBA) wiring, mirroring the web
 * app's factory. The admin app only uses the sweep: after an operator edits
 * guest data, `sweepEligibleBookings` re-enqueues a submission job because a
 * succeeded job older than the latest guest update no longer counts as
 * covering.
 */
export async function guestComplianceService(): Promise<GuestComplianceService> {
	const hostifyClient = createHostifyClientFromEnv();
	const settings = await getRuntimeSettings();

	return new GuestComplianceService({
		db: getDb(),
		resolveHostkitClient: (listingId) =>
			createHostkitClientForListingFromSettings(listingId),
		resolveReservationCode: async (providerReservationId) => {
			const response = await hostifyClient.reservations.get(
				providerReservationId,
			);
			const code = (response.reservation as { confirmation_code?: unknown })
				.confirmation_code;
			return typeof code === "string" && code.trim() ? code.trim() : null;
		},
		sendSiba: settings["features.hostkitSibaSendEnabled"] === true,
	});
}
