import {
	AccommodationPricingRepository,
	AccommodationSearchService,
	getAccommodationsConfig,
	parseAvailabilitySearchParams,
} from "@workspace/core/accommodations";
import {
	CatalogRepository,
	parseCatalogListQuery,
} from "@workspace/core/catalog";
import { getDb } from "@workspace/db";
import { withApiRoute } from "@/lib/api/route";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

export const GET = withApiRoute(
	{ name: "accommodations.search", rateLimit: { bucket: "default" } },
	async (request: Request): Promise<Response> => {
		const searchParams = new URL(request.url).searchParams;
		const catalog = parseCatalogListQuery(searchParams);

		if (!catalog.success) {
			return validationError("Invalid catalog parameters", catalog.error);
		}

		const config = getAccommodationsConfig();
		const scope = {
			accountId: config.hostifyAccountId,
			provider: HOSTIFY_PROVIDER,
		};
		const hasDates =
			searchParams.has("checkIn") || searchParams.has("checkOut");
		const availability = hasDates
			? parseAvailabilitySearchParams(searchParams)
			: null;

		if (availability && !availability.success) {
			return validationError(
				"Invalid availability parameters",
				availability.error,
			);
		}

		const db = getDb();
		const service = new AccommodationSearchService({
			catalog: new CatalogRepository(db),
			currency: config.currency,
			pricing: new AccommodationPricingRepository(db),
		});
		const result = await service.search({
			candidateLimit: config.liveSearchCandidateLimit,
			dates: availability?.success ? availability.data.dates : null,
			guests: availability?.success
				? availability.data.guests
				: catalog.data.minGuests,
			query: catalog.data,
			scope,
		});

		return Response.json({
			data: result.items,
			page: {
				limit: result.limit,
				offset: result.offset,
				priceBounds: result.priceBounds,
				total: result.total,
			},
		});
	},
);

function validationError(
	message: string,
	error: { issues: { message: string; path: PropertyKey[] }[] },
) {
	return Response.json(
		{
			error: message,
			issues: error.issues.map((issue) => ({
				message: issue.message,
				path: issue.path.join("."),
			})),
		},
		{ status: 400 },
	);
}
