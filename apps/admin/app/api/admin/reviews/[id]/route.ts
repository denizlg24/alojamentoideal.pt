import { ListingReviewRepository } from "@workspace/core/listing-reviews";
import { getDb } from "@workspace/db";
import { z } from "zod";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";

interface ReviewRouteContext {
	params: Promise<{ id: string }>;
}

const patchSchema = z.object({
	status: z.enum(["pending", "published", "hidden"]),
});

export const PATCH = withAdminRoute<ReviewRouteContext>(
	{ name: "admin.reviews.set_status", rateLimit: { bucket: "mutation" } },
	async (request, context): Promise<Response> => {
		const { id } = await context.params;
		const parsed = patchSchema.safeParse(await readJson(request));
		if (!parsed.success) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid review status." },
				{ status: 400 },
			);
		}

		const repository = new ListingReviewRepository(getDb());
		const scope = await repository.setStatus(id, parsed.data.status);
		if (!scope) {
			return Response.json(
				{ code: "not_found", error: "Review not found." },
				{ status: 404 },
			);
		}

		// Publishing or hiding changes what counts toward the listing's public
		// rating badge, so refresh that listing's aggregate right away. The web
		// app's cached pages pick the new numbers up on their next revalidation.
		await repository.recomputeSummaries(scope.provider, scope.accountId, [
			scope.listingExternalId,
		]);

		return Response.json({ id, status: parsed.data.status });
	},
);
