import {
	commerceErrorResponse,
	commerceService,
	resolveCartOwner,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface CartValidateRouteContext {
	params: Promise<{ cartId: string }>;
}

export const POST = withApiRoute<CartValidateRouteContext>(
	{ name: "cart.validate", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;
		const owner = await resolveCartOwner(request);

		try {
			return Response.json(await commerceService().validateCart(cartId, owner));
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
