import { createHostkitClientForListingFromSettings } from "@workspace/core/integrations/hostkit";
import { InvoicingError, InvoicingService } from "@workspace/core/invoicing";
import { getRuntimeSettings } from "@workspace/core/settings";
import { getDb } from "@workspace/db";
import { getAdminUser } from "../auth/admin";
import { type ApiRouteOptions, type RouteHandler, withApiRoute } from "./route";

/**
 * Kill switch for fiscal-document issuance. The admin endpoints must not be
 * able to touch real financial documents until the business enables the
 * Hostkit invoicing runtime setting.
 */
export async function invoicingEnabled(): Promise<boolean> {
	const settings = await getRuntimeSettings();
	return settings["features.hostkitInvoicingEnabled"] === true;
}

export function invoicingService(): InvoicingService {
	return new InvoicingService({
		db: getDb(),
		resolveHostkitClient: (listingId) =>
			createHostkitClientForListingFromSettings(listingId),
	});
}

/**
 * Shared guard for the admin invoicing routes: authenticated admin required;
 * mutations additionally require the env kill switch. Returns the rejection
 * response, or null when the request may proceed.
 */
export async function rejectUnlessInvoicingAdmin(
	request: Request,
	options: { mutation: boolean },
): Promise<Response | null> {
	const admin = await getAdminUser(request);
	if (!admin) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	if (options.mutation && !(await invoicingEnabled())) {
		return Response.json(
			{
				code: "invoicing_disabled",
				error:
					"Invoice issuance is disabled. Enable Hostkit invoicing in admin Settings to issue fiscal documents.",
			},
			{ status: 503 },
		);
	}
	return null;
}

const ERROR_STATUS: Record<InvoicingError["code"], number> = {
	already_invoiced: 409,
	billing_contact_missing: 422,
	credit_note_target_invalid: 422,
	invoice_delete_forbidden: 409,
	partial_credit_invalid: 422,
	currency_unsupported: 422,
	customer_country_unresolved: 422,
	hostkit_not_configured: 422,
	invoice_not_found: 404,
	order_item_not_found: 404,
	order_not_found: 404,
	order_not_paid: 422,
	property_unconfigured: 422,
	provider_error: 502,
	reservation_code_unavailable: 422,
	provider_closed_but_persistence_failed: 502,
};

interface InvoicingAdminRouteOptions extends ApiRouteOptions {
	mutation?: boolean;
}

export function invoicingErrorResponse(error: unknown): Response | null {
	if (!(error instanceof InvoicingError)) {
		return null;
	}
	return Response.json(
		{ code: error.code, error: error.message },
		{ status: ERROR_STATUS[error.code] ?? 500 },
	);
}

export function withInvoicingAdmin<Ctx = unknown>(
	options: InvoicingAdminRouteOptions,
	handler: RouteHandler<Ctx>,
) {
	const { mutation = true, ...routeOptions } = options;

	return withApiRoute<Ctx>(
		routeOptions,
		async (request: Request, context): Promise<Response> => {
			const rejection = await rejectUnlessInvoicingAdmin(request, {
				mutation,
			});
			if (rejection) {
				return rejection;
			}
			try {
				return await handler(request, context);
			} catch (error) {
				const handled = invoicingErrorResponse(error);
				if (handled) {
					return handled;
				}
				throw error;
			}
		},
	);
}
