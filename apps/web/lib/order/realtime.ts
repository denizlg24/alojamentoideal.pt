"use client";

import type {
	ConversationMessageDto,
	ConversationSummary,
} from "@workspace/core/commerce";
import Pusher from "pusher-js";
import { useEffect, useRef } from "react";

export function isRealtimeConfigured(): boolean {
	return Boolean(
		process.env.NEXT_PUBLIC_PUSHER_KEY &&
			process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
	);
}

interface UseOrderConversationOptions {
	channelName: string | null;
	enabled?: boolean;
	onConversation?: (conversation: ConversationSummary) => void;
	onMessage: (message: ConversationMessageDto) => void;
	reference: string;
}

/**
 * Subscribes the browser to a conversation's private Pusher channel for the
 * lifetime of the component. The channel is authorized server-side via
 * `/api/realtime/auth` (which gates on order access), so the reference is sent
 * with the auth request. Handlers are kept in refs so changing callback
 * identity never tears down and re-establishes the subscription.
 */
export function useOrderConversation({
	channelName,
	enabled = true,
	onConversation,
	onMessage,
	reference,
}: UseOrderConversationOptions): void {
	const onMessageRef = useRef(onMessage);
	const onConversationRef = useRef(onConversation);
	onMessageRef.current = onMessage;
	onConversationRef.current = onConversation;

	useEffect(() => {
		if (!enabled || !channelName) {
			return;
		}
		const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
		const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
		if (!key || !cluster) {
			return;
		}

		const pusher = new Pusher(key, {
			channelAuthorization: {
				endpoint: "/api/realtime/auth",
				params: { reference },
				transport: "ajax",
			},
			cluster,
		});
		const channel = pusher.subscribe(channelName);

		channel.bind(
			"message.created",
			(data: { message: ConversationMessageDto }) => {
				onMessageRef.current(data.message);
			},
		);
		channel.bind(
			"conversation.updated",
			(data: { conversation: ConversationSummary }) => {
				onConversationRef.current?.(data.conversation);
			},
		);

		return () => {
			channel.unbind_all();
			pusher.unsubscribe(channelName);
			pusher.disconnect();
		};
	}, [channelName, enabled, reference]);
}
