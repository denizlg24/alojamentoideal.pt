"use client";

import type {
	ConversationMessageDto,
	ConversationSummary,
} from "@workspace/core/commerce";
import Pusher from "pusher-js";
import { type MutableRefObject, useEffect, useRef } from "react";

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

export interface UseOrderConversationResult {
	/**
	 * The browser's current Pusher socket id, or `null` before the connection is
	 * established. Read it at send time and hand it to the message API so the
	 * server excludes this connection from the broadcast, preventing the sender
	 * from receiving an echo of its own message.
	 */
	socketIdRef: MutableRefObject<string | null>;
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
}: UseOrderConversationOptions): UseOrderConversationResult {
	const onMessageRef = useRef(onMessage);
	const onConversationRef = useRef(onConversation);
	const socketIdRef = useRef<string | null>(null);
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
		socketIdRef.current = pusher.connection.socket_id || null;
		pusher.connection.bind("connected", () => {
			socketIdRef.current = pusher.connection.socket_id || null;
		});
		pusher.connection.bind("disconnected", () => {
			socketIdRef.current = null;
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
			pusher.connection.unbind("connected");
			pusher.connection.unbind("disconnected");
			pusher.unsubscribe(channelName);
			pusher.disconnect();
			socketIdRef.current = null;
		};
	}, [channelName, enabled, reference]);

	return { socketIdRef };
}
