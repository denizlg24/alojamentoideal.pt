import { GuestComplianceService } from "@workspace/core/compliance";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { createHostkitClientForListingFromSettings } from "@workspace/core/integrations/hostkit";
import { getRuntimeSettings } from "@workspace/core/settings";
import { getDb } from "@workspace/db";

/**
 * Guest-registration compliance (Hostkit/SIBA) wiring. Auto-filing the SIBA
 * bulletin is opt-in: without HOSTKIT_SIBA_SEND_ENABLED=true the job syncs the
 * roster to Hostkit and stops after validateSIBA.
 */
export async function guestComplianceService(): Promise<GuestComplianceService> {
	const hostifyClient = createHostifyClientFromEnv();
	const settings = await getRuntimeSettings();

	return new GuestComplianceService({
		db: getDb(),
		resolveHostkitClient: (listingId) =>
			createHostkitClientForListingFromSettings(listingId),
		// Holds persisted before the confirmation code reached the operational
		// payload re-read it from the Hostify reservation.
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
