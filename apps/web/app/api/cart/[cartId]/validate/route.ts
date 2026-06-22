import { commerceErrorResponse, commerceService } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

interface CartValidateRouteContext {
	params: Promise<{ cartId: string }>;
}

export const POST = withApiRoute<CartValidateRouteContext>(
	{ name: "cart.validate", rateLimit: { bucket: "cart.write" } },
	async (_request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;

		try {
			return Response.json(await commerceService().validateCart(cartId));
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
