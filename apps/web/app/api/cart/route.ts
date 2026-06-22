import { parseCreateCartBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const POST = withApiRoute(
	{ name: "cart.create", rateLimit: { bucket: "cart.write" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseCreateCartBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid cart request");
		}

		try {
			return Response.json(await commerceService().createCart(parsed.data));
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
