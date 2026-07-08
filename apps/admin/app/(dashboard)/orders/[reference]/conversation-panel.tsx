"use client";

import type { ConversationMessageDto } from "@workspace/core/commerce";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { Send } from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
	useTransition,
} from "react";
import {
	readConversationMessages,
	sendConversationMessage,
} from "@/lib/orders/conversation-api";
import { useAdminOrderConversation } from "@/lib/orders/realtime";

type UiMessage = ConversationMessageDto & { localOnly?: boolean };

function sortBySentAt(messages: UiMessage[]): UiMessage[] {
	return [...messages].sort(
		(a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
	);
}

function sameMessage(a: UiMessage, b: UiMessage): boolean {
	return (
		a.body === b.body &&
		a.conversationId === b.conversationId &&
		a.deliveryStatus === b.deliveryStatus &&
		a.externalMessageId === b.externalMessageId &&
		a.id === b.id &&
		(a.localOnly ?? false) === (b.localOnly ?? false) &&
		a.senderType === b.senderType &&
		a.sentAt === b.sentAt
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

function replaceAt(
	messages: UiMessage[],
	index: number,
	next: UiMessage,
): UiMessage[] {
	const copy = [...messages];
	copy[index] = next;
	return sortBySentAt(copy);
}

function mergeMessages(
	current: UiMessage[],
	incomingMessages: ConversationMessageDto[],
	conversationId: string,
): UiMessage[] {
	const incoming = incomingMessages.map((message) => ({
		...message,
		localOnly: false,
	}));
	const incomingIds = new Set(incoming.map((message) => message.id));
	const incomingExternalIds = new Set(
		incoming
			.map((message) => message.externalMessageId)
			.filter((id): id is string => id !== null),
	);
	const currentById = new Map(current.map((message) => [message.id, message]));
	const mergedIncoming = incoming.map((message) => {
		const existing = currentById.get(message.id);
		if (
			existing?.deliveryStatus === "sent" &&
			message.deliveryStatus === "pending"
		) {
			return existing;
		}
		return message;
	});
	const preserved = current.filter((message) => {
		if (
			message.conversationId !== conversationId ||
			incomingIds.has(message.id)
		) {
			return false;
		}
		if (
			message.externalMessageId &&
			incomingExternalIds.has(message.externalMessageId)
		) {
			return false;
		}
		if (
			message.localOnly &&
			incoming.some(
				(incomingMessage) =>
					incomingMessage.senderType === "host" &&
					incomingMessage.body === message.body,
			)
		) {
			return false;
		}
		return true;
	});
	const next = sortBySentAt([...mergedIncoming, ...preserved]);
	return current.length === next.length &&
		current.every((message, index) => {
			const nextMessage = next[index];
			return nextMessage !== undefined && sameMessage(message, nextMessage);
		})
		? current
		: next;
}

function formatTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d, HH:mm");
}

function upsertIncoming(
	current: UiMessage[],
	incoming: ConversationMessageDto,
) {
	const existing = current.find((message) => message.id === incoming.id);
	if (existing) {
		if (
			existing.deliveryStatus === "sent" &&
			incoming.deliveryStatus === "pending"
		) {
			return current;
		}
		return replaceById(current, incoming.id, {
			...incoming,
			localOnly: false,
		});
	}
	if (
		incoming.externalMessageId &&
		current.some(
			(message) => message.externalMessageId === incoming.externalMessageId,
		)
	) {
		return current;
	}
	if (incoming.senderType === "host") {
		const optimisticMatches: number[] = [];
		for (const [index, message] of current.entries()) {
			if (message.localOnly && message.body === incoming.body) {
				optimisticMatches.push(index);
			}
		}
		if (optimisticMatches.length === 1 && optimisticMatches[0] !== undefined) {
			return replaceAt(current, optimisticMatches[0], {
				...incoming,
				localOnly: false,
			});
		}
		if (optimisticMatches.length > 1) {
			return current;
		}
	}
	return sortBySentAt([...current, { ...incoming, localOnly: false }]);
}

function MessageBubble({ message }: { message: UiMessage }) {
	const isHost = message.senderType === "host";
	const isSystem = message.senderType === "system";
	if (isSystem) {
		return (
			<p className="mx-auto max-w-[80%] text-center text-muted-foreground text-xs">
				{message.body}
			</p>
		);
	}

	return (
		<div
			className={cn(
				"flex max-w-[80%] flex-col gap-1",
				isHost ? "items-end self-end" : "items-start self-start",
			)}
		>
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<span>{isHost ? "Admin" : "Guest"}</span>
				{message.isAutomatic ? (
					<Badge className="h-4 px-1.5 font-normal" variant="outline">
						Automated
					</Badge>
				) : null}
			</div>
			<div
				className={cn(
					"whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
					isHost ? "bg-foreground text-background" : "bg-muted text-foreground",
					message.deliveryStatus === "failed" &&
						"bg-destructive/10 text-destructive",
				)}
			>
				{message.body}
			</div>
			<span className="px-1 text-muted-foreground text-xs">
				{message.deliveryStatus === "pending"
					? "Sending..."
					: message.deliveryStatus === "failed"
						? "Not sent"
						: formatTime(message.sentAt)}
			</span>
		</div>
	);
}

export function ConversationPanel({
	channelName,
	conversationId,
	initialMessages,
	messagesLoadError,
	reference,
}: {
	channelName: string | null;
	conversationId: string | null;
	initialMessages: ConversationMessageDto[];
	messagesLoadError: boolean;
	reference: string;
}) {
	const [messages, setMessages] = useState<UiMessage[]>(() =>
		sortBySentAt(initialMessages),
	);
	const [input, setInput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!conversationId) {
			return;
		}
		setMessages((current) =>
			mergeMessages(current, initialMessages, conversationId),
		);
	}, [conversationId, initialMessages]);

	const { socketIdRef } = useAdminOrderConversation({
		channelName,
		enabled: conversationId !== null && !messagesLoadError,
		onMessage: (incoming) => {
			setMessages((current) => upsertIncoming(current, incoming));
		},
		reference,
	});

	useEffect(() => {
		if (!conversationId || channelName) {
			return;
		}
		const interval = setInterval(async () => {
			try {
				const { messages: latest } = await readConversationMessages(
					reference,
					conversationId,
				);
				setMessages((current) =>
					mergeMessages(current, latest, conversationId),
				);
			} catch {
				// Polling is only the fallback path when realtime is not configured.
			}
		}, 5000);
		return () => clearInterval(interval);
	}, [channelName, conversationId, reference]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the effect should run when the list grows, while reading the DOM node through the ref.
	useEffect(() => {
		const list = listRef.current;
		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	}, [messages.length]);

	function sendMessage() {
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
			senderType: "host",
			sentAt: new Date().toISOString(),
		};
		setMessages((current) => sortBySentAt([...current, optimistic]));
		setInput("");

		startTransition(async () => {
			try {
				const { message } = await sendConversationMessage(
					reference,
					conversationId,
					body,
					socketIdRef.current,
				);
				setMessages((current) =>
					replaceById(current, localId, { ...message, localOnly: false }),
				);
			} catch (caught) {
				setError(
					caught instanceof Error ? caught.message : "Could not send message.",
				);
				setMessages((current) =>
					current.map((message) =>
						message.id === localId
							? { ...message, deliveryStatus: "failed" }
							: message,
					),
				);
			}
		});
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	return (
		<section className="mt-10">
			<div className="flex items-center justify-between gap-4">
				<h2 className="font-medium text-sm">Messages</h2>
				{channelName ? (
					<span className="text-emerald-600 text-xs">Live</span>
				) : (
					<span className="text-muted-foreground text-xs">Polling</span>
				)}
			</div>
			{conversationId === null ? (
				<p className="mt-3 text-muted-foreground text-sm">
					No conversation exists yet. The conversation cron creates one once the
					booking is confirmed: a Hostify thread when the reservation has one,
					otherwise an in-app conversation.
				</p>
			) : (
				<div className="mt-3 space-y-3">
					<div
						className="flex max-h-[420px] min-h-64 flex-col gap-3 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-4"
						ref={listRef}
					>
						{messagesLoadError ? (
							<p className="m-auto text-center text-destructive text-sm">
								There was a problem loading messages.
							</p>
						) : messages.length === 0 ? (
							<p className="m-auto text-center text-muted-foreground text-sm">
								No messages yet.
							</p>
						) : (
							messages.map((message) => (
								<MessageBubble key={message.id} message={message} />
							))
						)}
					</div>
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
					<div className="flex items-end gap-2">
						<Textarea
							className="min-h-10 resize-none"
							disabled={messagesLoadError}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Write a reply..."
							rows={1}
							value={input}
						/>
						<Button
							disabled={
								pending || input.trim().length === 0 || messagesLoadError
							}
							onClick={sendMessage}
							size="icon"
							type="button"
						>
							<Send className="size-4" />
						</Button>
					</div>
				</div>
			)}
		</section>
	);
}
