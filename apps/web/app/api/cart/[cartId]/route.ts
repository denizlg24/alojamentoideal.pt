import {
	commerceErrorResponse,
	commerceService,
	resolveCartOwner,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

interface CartRouteContext {
	params: Promise<{ cartId: string }>;
}

export const GET = withApiRoute<CartRouteContext>(
	{ name: "cart.get", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;
		const owner = await resolveCartOwner(request);

		try {
			return Response.json(await commerceService().getCart(cartId, owner));
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
