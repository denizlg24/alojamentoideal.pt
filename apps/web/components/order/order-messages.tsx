"use client";

import type {
	ConversationMessageDto,
	OrderConversationAvailability,
} from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toCheckoutError } from "@/lib/checkout/errors";
import * as orderApi from "@/lib/order/api-client";
import { useOrderConversation } from "@/lib/order/realtime";

type UiMessage = ConversationMessageDto & { localOnly?: boolean };

function sortBySentAt(messages: UiMessage[]): UiMessage[] {
	return [...messages].sort(
		(a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
	);
}

function replaceById(
	messages: UiMessage[],
	id: string,
	next: UiMessage,
): UiMessage[] {
	return sortBySentAt(
		messages.map((message) => (message.id === id ? next : message)),
	);
}

function formatTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : format(date, "p");
}

function MessageBubble({
	message,
	onRetry,
}: {
	message: UiMessage;
	onRetry: (message: UiMessage) => void;
}) {
	if (message.senderType === "system") {
		return (
			<p className="mx-auto max-w-[80%] text-center text-muted-foreground text-xs">
				{message.body}
			</p>
		);
	}

	const isGuest = message.senderType === "guest";
	const failed = message.deliveryStatus === "failed";
	const pending = message.deliveryStatus === "pending";

	return (
		<div
			className={cn(
				"flex max-w-[80%] flex-col gap-0.5",
				isGuest ? "items-end self-end" : "items-start self-start",
			)}
		>
			<div
				className={cn(
					"whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
					isGuest
						? "bg-foreground text-background"
						: "bg-muted text-foreground",
				)}
			>
				{message.body}
			</div>
			<div className="flex items-center gap-1.5 px-1 text-muted-foreground text-xs">
				{pending ? (
					<span>Sending…</span>
				) : failed ? (
					<>
						<span className="text-destructive">Not sent</span>
						<button
							className="underline"
							onClick={() => onRetry(message)}
							type="button"
						>
							Retry
						</button>
					</>
				) : (
					<span>{formatTime(message.sentAt)}</span>
				)}
			</div>
		</div>
	);
}

function emptyStateCopy(availability: OrderConversationAvailability): string {
	if (availability === "pending") {
		return "Your conversation with the Alojamento Ideal team opens once your booking is confirmed.";
	}
	return "Messaging will be available once your booking is confirmed.";
}

export function OrderMessages({
	availability,
	channelName,
	conversationId,
	initialMessages,
	reference,
}: {
	availability: OrderConversationAvailability;
	channelName: string | null;
	conversationId: string | null;
	initialMessages: ConversationMessageDto[];
	reference: string;
}) {
	const [messages, setMessages] = useState<UiMessage[]>(() =>
		sortBySentAt(initialMessages),
	);
	const [input, setInput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const canSend = availability === "available" && conversationId !== null;

	useOrderConversation({
		channelName,
		enabled: conversationId !== null,
		onMessage: (incoming) => {
			setMessages((current) => {
				if (current.some((message) => message.id === incoming.id)) {
					return current;
				}
				if (
					incoming.externalMessageId &&
					current.some(
						(message) =>
							message.externalMessageId === incoming.externalMessageId,
					)
				) {
					return current;
				}
				return sortBySentAt([...current, { ...incoming, localOnly: false }]);
			});
		},
		reference,
	});

	// Keep the thread pinned to the latest message as it grows (and on mount).
	// biome-ignore lint/correctness/useExhaustiveDependencies: the effect must re-run when the message count changes, even though the body reads it only through the ref.
	useEffect(() => {
		const list = listRef.current;
		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	}, [messages.length]);

	async function deliver(localId: string, body: string) {
		if (!conversationId) {
			return;
		}
		try {
			const { message } = await orderApi.sendConversationMessage(
				reference,
				conversationId,
				body,
			);
			setMessages((current) =>
				replaceById(current, localId, { ...message, localOnly: false }),
			);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
			setMessages((current) =>
				current.map((message) =>
					message.id === localId
						? { ...message, deliveryStatus: "failed" }
						: message,
				),
			);
		}
	}

	async function handleSend() {
		const body = input.trim();
		if (!body || !conversationId) {
			return;
		}
		setError(null);
		const localId = `local-${crypto.randomUUID()}`;
		const optimistic: UiMessage = {
			body,
			conversationId,
			deliveryStatus: "pending",
			externalMessageId: null,
			id: localId,
			isAutomatic: false,
			localOnly: true,
			readAt: null,
			senderMemberId: null,
			senderType: "guest",
			sentAt: new Date().toISOString(),
		};
		setMessages((current) => sortBySentAt([...current, optimistic]));
		setInput("");
		await deliver(localId, body);
	}

	async function handleRetry(message: UiMessage) {
		if (!conversationId) {
			return;
		}
		setError(null);
		setMessages((current) =>
			current.map((entry) =>
				entry.id === message.id
					? { ...entry, deliveryStatus: "pending" }
					: entry,
			),
		);
		// A locally failed send never reached the server, so re-post it; a
		// server-persisted failed row is retried in place by its id.
		if (message.localOnly) {
			await deliver(message.id, message.body);
			return;
		}
		try {
			const { message: sent } = await orderApi.retryConversationMessage(
				reference,
				conversationId,
				message.id,
			);
			setMessages((current) =>
				replaceById(current, message.id, { ...sent, localOnly: false }),
			);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
			setMessages((current) =>
				current.map((entry) =>
					entry.id === message.id
						? { ...entry, deliveryStatus: "failed" }
						: entry,
				),
			);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void handleSend();
		}
	}

	if (conversationId === null) {
		return (
			<div className="flex flex-col gap-2">
				<h2 className="font-heading font-medium text-base">Messages</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					{emptyStateCopy(availability)}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<h2 className="font-heading font-medium text-base">Messages</h2>

			<div
				className="flex max-h-[55vh] min-h-64 flex-col gap-3 overflow-y-auto rounded-2xl bg-muted/30 p-4"
				ref={listRef}
			>
				{messages.length === 0 ? (
					<p className="m-auto text-center text-muted-foreground text-sm">
						No messages yet. Say hello to start the conversation.
					</p>
				) : (
					messages.map((message) => (
						<MessageBubble
							key={message.id}
							message={message}
							onRetry={handleRetry}
						/>
					))
				)}
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			{canSend ? (
				<div className="flex items-end gap-2">
					<Textarea
						className="min-h-11 resize-none"
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Write a message…"
						rows={1}
						value={input}
					/>
					<Button
						className="shrink-0"
						disabled={input.trim().length === 0}
						onClick={handleSend}
						type="button"
					>
						Send
					</Button>
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					{emptyStateCopy(availability)}
				</p>
			)}
		</div>
	);
}
