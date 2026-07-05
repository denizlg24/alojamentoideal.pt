import "server-only";

import {
	CommerceError,
	type OrderDetail,
	type ResolvedOrderAccess,
} from "@workspace/core/commerce";
import { cache } from "react";
import {
	commerceService,
	resolveOrderAccessFromCookies,
} from "@/lib/api/commerce";

export interface LoadedOrder {
	access: ResolvedOrderAccess;
	detail: OrderDetail;
}

/**
 * Resolves the current visitor's access to an order and builds its hub read
 * model, or returns `null` when the order is unknown or the visitor is not
 * authorized (a missing order and a forbidden one are indistinguishable, so the
 * reference stays unenumerable). Wrapped in React `cache` so a layout/page pair
 * and sibling section pages within one request share a single resolve + read.
 */
export const loadOrderForRequest = cache(
	async (reference: string): Promise<LoadedOrder | null> => {
		const accessContext = await resolveOrderAccessFromCookies(reference);
		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			return { access, detail };
		} catch (error) {
			if (error instanceof CommerceError && error.status === 404) {
				return null;
			}
			throw error;
		}
	},
);
