import {
	type ConversationMessageDto,
	conversationChannelName,
	type OrderConversationSummary,
} from "@workspace/core/commerce";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import { OrderMessages } from "@/components/order/order-messages";
import { commerceService } from "@/lib/api/commerce";
import { loadOrderForRequest } from "@/lib/order/load";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Messages · Your booking",
	description: "Message the Alojamento Ideal team about a private booking.",
});

interface OrderMessagesPageProps {
	params: Promise<{ reference: string }>;
}

/** Prefer a live thread, else the first conversation, else none. */
function primaryConversation(
	conversations: OrderConversationSummary[],
): OrderConversationSummary | null {
	const live = conversations.find(
		(conversation) =>
			conversation.status === "active" && conversation.externalThreadId,
	);
	return live ?? conversations[0] ?? null;
}

async function OrderMessagesRoute({ params }: OrderMessagesPageProps) {
	const { reference } = await params;
	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}
	if (loaded.detail.role !== "owner") {
		return <OrderAccessDenied />;
	}

	const conversation = primaryConversation(loaded.detail.conversations);
	const channelName = conversation
		? conversationChannelName(loaded.access.order.id, conversation.id)
		: null;
	let initialMessages: ConversationMessageDto[] = [];
	let messagesLoadError = false;
	if (conversation) {
		try {
			initialMessages = await commerceService().readConversationMessages(
				loaded.access,
				conversation.id,
				{ limit: 50 },
			);
		} catch (error) {
			console.error("Failed to load order conversation messages", error);
			messagesLoadError = true;
		}
	}

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderMessages
				availability={loaded.detail.conversationAvailability}
				channelName={channelName}
				conversationId={conversation?.id ?? null}
				initialMessages={initialMessages}
				messagesLoadError={messagesLoadError}
				reference={reference}
			/>
		</OrderHubShell>
	);
}

export default function OrderMessagesPage(props: OrderMessagesPageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderMessagesRoute {...props} />
		</Suspense>
	);
}
