import { parseCatalogLocale } from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { withApiRoute } from "@/lib/api";
import { getCachedCatalogDetail } from "@/lib/catalog-cache";
import { HOSTIFY_PROVIDER } from "@/lib/catalog-constants";

interface DetailRouteContext {
	params: Promise<{ externalId: string }>;
}

export const GET = withApiRoute<DetailRouteContext>(
	{ name: "catalog.listings.detail", rateLimit: { bucket: "default" } },
	async (request: Request, context: DetailRouteContext): Promise<Response> => {
		const { externalId } = await context.params;
		const locale = parseCatalogLocale(
			new URL(request.url).searchParams.get("lang"),
		);

		const config = getListingCacheConfig();
		const listing = await getCachedCatalogDetail(
			externalId,
			{ accountId: config.hostifyAccountId, provider: HOSTIFY_PROVIDER },
			locale,
		);

		if (!listing) {
			return Response.json({ error: "Listing not found" }, { status: 404 });
		}

		return Response.json({ data: listing });
	},
);
