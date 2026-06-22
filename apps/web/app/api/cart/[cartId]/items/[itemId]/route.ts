import {
	parseDeleteCartItemBody,
	parseUpdateCartItemBody,
} from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

interface CartItemRouteContext {
	params: Promise<{ cartId: string; itemId: string }>;
}

export const PATCH = withApiRoute<CartItemRouteContext>(
	{ name: "cart.items.update", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId, itemId } = await context.params;
		const parsed = parseUpdateCartItemBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid cart item update");
		}

		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().updateItem(cartId, itemId, parsed.data, owner),
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

export const DELETE = withApiRoute<CartItemRouteContext>(
	{ name: "cart.items.delete", rateLimit: { bucket: "cart.write" } },
	async (request: Request, context): Promise<Response> => {
		const { cartId, itemId } = await context.params;
		// DELETE carries no body: many proxies and HTTP clients strip request
		// bodies on DELETE, so the optional idempotency key rides a query param.
		const idempotencyKey = new URL(request.url).searchParams.get(
			"idempotencyKey",
		);
		const parsed = parseDeleteCartItemBody(
			idempotencyKey === null ? {} : { idempotencyKey },
		);
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid cart item delete");
		}

		const owner = await resolveCartOwner(request);

		try {
			return Response.json(
				await commerceService().removeItem(cartId, itemId, parsed.data, owner),
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
