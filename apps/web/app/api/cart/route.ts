import { parseCreateCartBody } from "@workspace/core/commerce";
import {
	cartCookie,
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const POST = withApiRoute(
	{ name: "cart.create", rateLimit: { bucket: "cart.write" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseCreateCartBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid cart request");
		}

		const owner = await resolveCartOwner(request);

		try {
			const result = await commerceService().createCart(parsed.data, owner);
			const response = Response.json(result);
			response.headers.append("Set-Cookie", cartCookie(result.cart.cartToken));
			return response;
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
