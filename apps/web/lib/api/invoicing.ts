import { createHostkitClientForListing } from "@workspace/core/integrations/hostkit";
import { InvoicingError, InvoicingService } from "@workspace/core/invoicing";
import { getDb } from "@workspace/db";
import { getAdminUser } from "@/lib/auth/admin";

/**
 * Kill switch for fiscal-document issuance. The admin endpoints exist ahead
 * of the M7 dashboard but must not be able to touch real financial documents
 * until the business flips HOSTKIT_INVOICING_ENABLED=true.
 */
export function invoicingEnabled(): boolean {
	return process.env.HOSTKIT_INVOICING_ENABLED === "true";
}

export function invoicingService(): InvoicingService {
	return new InvoicingService({
		db: getDb(),
		resolveHostkitClient: (listingId) =>
			createHostkitClientForListing(listingId),
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
	if (options.mutation && !invoicingEnabled()) {
		return Response.json(
			{
				code: "invoicing_disabled",
				error:
					"Invoice issuance is disabled. Set HOSTKIT_INVOICING_ENABLED=true to enable it.",
			},
			{ status: 503 },
		);
	}
	return null;
}

const ERROR_STATUS: Record<InvoicingError["code"], number> = {
	already_invoiced: 409,
	credit_note_target_invalid: 422,
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
};

export function invoicingErrorResponse(error: unknown): Response | null {
	if (!(error instanceof InvoicingError)) {
		return null;
	}
	return Response.json(
		{ code: error.code, error: error.message },
		{ status: ERROR_STATUS[error.code] ?? 500 },
	);
}
