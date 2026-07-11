import { z } from "zod";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";
import { defaultCatalogScope } from "@/lib/catalog/scope";
import { listingReviewRepository } from "@/lib/order/reviews";

interface ReviewRouteContext {
	params: Promise<{ reference: string }>;
}

const requestSchema = z.object({
	comments: z.string().trim().max(2000).optional().default(""),
	itemId: z.string().trim().min(1),
	rating: z.number().int().min(1).max(5),
});

export const POST = withApiRoute<ReviewRouteContext>(
	{ name: "orders.reviews.create", rateLimit: { bucket: "mutation" } },
	async (request, context): Promise<Response> => {
		const { reference } = await context.params;
		const parsed = requestSchema.safeParse(await readJson(request));
		if (!parsed.success) {
			return Response.json(
				{ code: "invalid_request", error: "Please check your review." },
				{ status: 400 },
			);
		}

		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(
				reference,
				await resolveOrderAccessContext(request, reference),
			);
			if (access.role !== "owner") {
				return Response.json(
					{
						code: "forbidden",
						error: "Only the person who booked can leave a review.",
					},
					{ status: 403 },
				);
			}

			const detail = await service.readOrderDetail(access);
			if (detail.bookingStatus !== "confirmed") {
				return Response.json(
					{
						code: "not_reviewable",
						error: "Reviews open once the booking is confirmed.",
					},
					{ status: 409 },
				);
			}

			const item = detail.items.find(
				(candidate) => candidate.id === parsed.data.itemId,
			);
			if (item?.type !== "accommodation" || item.listingExternalId === null) {
				return Response.json(
					{ code: "invalid_request", error: "This item cannot be reviewed." },
					{ status: 400 },
				);
			}

			const today = new Date().toISOString().slice(0, 10);
			if (item.checkIn === null || item.checkIn > today) {
				return Response.json(
					{
						code: "too_early",
						error: "You can review this stay after check-in.",
					},
					{ status: 409 },
				);
			}

			const repository = listingReviewRepository();
			const scope = defaultCatalogScope();
			const existing = await repository.findByReservation(
				scope.provider,
				scope.accountId,
				"internal",
				item.id,
			);
			if (existing) {
				return Response.json(
					{
						code: "already_reviewed",
						error: "You already reviewed this stay.",
					},
					{ status: 409 },
				);
			}

			const user = await getServerUser(request);
			// New guest reviews land as `pending`; the admin reviews page publishes
			// them, which is when they start counting toward the public rating.
			await repository.upsertReview({
				accountId: scope.accountId,
				accuracyRating: null,
				channel: "direct",
				channelListingExternalId: null,
				channelReviewId: null,
				checkinRating: null,
				cleanRating: null,
				comments: parsed.data.comments || null,
				communicationRating: null,
				externalId: null,
				guestId: user?.id ?? null,
				guestName: detail.contact?.name ?? user?.name ?? null,
				language: null,
				listingExternalId: item.listingExternalId,
				locationRating: null,
				provider: scope.provider,
				rating: parsed.data.rating,
				raw: { orderItemId: item.id, orderReference: detail.reference },
				reservationId: item.id,
				reviewedAt: new Date(),
				source: "internal",
				status: "pending",
				syncRunId: null,
				valueRating: null,
			});

			return Response.json({ status: "pending" }, { status: 201 });
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
