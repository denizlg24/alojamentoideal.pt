import { parseApplyDiscountBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

interface CartDiscountRouteContext {
	params: Promise<{ cartId: string }>;
}

export const POST = withApiRoute<CartDiscountRouteContext>(
	{ name: "cart.discount.apply", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;
		const parsed = parseApplyDiscountBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid discount request");
		}

		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().applyDiscount(cartId, parsed.data, owner),
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

export const DELETE = withApiRoute<CartDiscountRouteContext>(
	{ name: "cart.discount.remove", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId } = await context.params;
		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().removeDiscount(cartId, owner),
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
