import { z } from "zod";
import { commerceErrorResponse, readJson } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import {
	resolveOrderActivityItemForRequest,
	submitOrderActivityAnswers,
} from "@/lib/order/activity";

interface OrderItemQuestionsRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

const answersBodySchema = z.object({
	answers: z
		.array(
			z.object({
				group: z.enum([
					"activity",
					"mainContact",
					"passengerDetails",
					"passengerQuestions",
					"pickup",
				]),
				passengerBookingId: z.string().max(64).nullable().optional(),
				questionId: z.string().min(1).max(200),
				values: z.array(z.string().max(2000)).max(20),
			}),
		)
		.max(300),
});

/**
 * Saves edited post-booking answers for one activity order item. The provider
 * copy stays the source of truth: the current questions are re-read, the edits
 * applied on top and the merged set pushed back to Bokun. Owner-only.
 */
export const PUT = withApiRoute<OrderItemQuestionsRouteContext>(
	{
		name: "orders.activity_questions_update",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { itemId, reference } = await context.params;
		const parsed = answersBodySchema.safeParse(await readJson(request));
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Invalid answers",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		try {
			const resolved = await resolveOrderActivityItemForRequest(
				request,
				reference,
				itemId,
			);
			if (!resolved.ok) {
				return resolved.response;
			}
			const result = await submitOrderActivityAnswers(
				resolved.item,
				parsed.data.answers,
			);
			if (result.status === "unavailable") {
				return Response.json(
					{
						code: "questions_unavailable",
						error: "Booking questions are not available yet.",
					},
					{ status: 409 },
				);
			}
			if (result.status === "incomplete") {
				return Response.json(
					{
						code: "questions_incomplete",
						error: "Please answer every required question.",
					},
					{ status: 422 },
				);
			}
			return new Response(null, { status: 204 });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
