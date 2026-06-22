import { parseAddCartItemBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

interface CartItemsRouteContext {
	params: Promise<{ cartId: string }>;
}

export const POST = withApiRoute<CartItemsRouteContext>(
	{ name: "cart.items.create", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;
		const parsed = parseAddCartItemBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid cart item request");
		}

		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().addItem(cartId, parsed.data, owner),
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
