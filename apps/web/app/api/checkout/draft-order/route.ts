import { parseDraftOrderBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const POST = withApiRoute(
	{ name: "checkout.draft_order", rateLimit: { bucket: "checkout.write" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseDraftOrderBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid draft order request");
		}

		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().createDraftOrder(parsed.data, owner),
			);
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
