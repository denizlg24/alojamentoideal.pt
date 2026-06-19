import { parseCatalogListQuery } from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { withApiRoute } from "@/lib/api";
import { getCachedCatalogList } from "@/lib/catalog-cache";

const PROVIDER = "hostify";

export const GET = withApiRoute(
	{ name: "catalog.listings.list", rateLimit: { bucket: "default" } },
	async (request: Request): Promise<Response> => {
		const { searchParams } = new URL(request.url);
		const parsed = parseCatalogListQuery(searchParams);

		if (!parsed.success) {
			return Response.json(
				{
					error: "Invalid query parameters",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const config = getListingCacheConfig();
		const result = await getCachedCatalogList(parsed.data, {
			accountId: config.hostifyAccountId,
			provider: PROVIDER,
		});

		return Response.json({
			data: result.items,
			page: {
				limit: result.limit,
				offset: result.offset,
				total: result.total,
			},
		});
	},
);
