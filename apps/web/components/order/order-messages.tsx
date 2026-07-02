"use client";

import type {
	ConversationMessageDto,
	OrderConversationAvailability,
} from "@workspace/core/commerce";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { AlertCircle, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toCheckoutError } from "@/lib/checkout/errors";
import * as orderApi from "@/lib/order/api-client";
import { useOrderConversation } from "@/lib/order/realtime";

const HOST_NAME = "Alojamento Ideal";
const HOST_AVATAR_SRC = "/alojamento-ideal-logo.png";

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
		a.isAutomatic === b.isAutomatic &&
		(a.localOnly ?? false) === (b.localOnly ?? false) &&
		a.readAt === b.readAt &&
		a.senderMemberId === b.senderMemberId &&
		a.senderType === b.senderType &&
		a.sentAt === b.sentAt
	);
}

function sameMessages(a: UiMessage[], b: UiMessage[]): boolean {
	return (
		a.length === b.length &&
		a.every((message, index) => {
			const next = b[index];
			return next !== undefined && sameMessage(message, next);
		})
	);
}

function isSameOptimisticGuestMessage(
	message: UiMessage,
	initialMessage: UiMessage,
): boolean {
	return (
		message.localOnly === true &&
		message.senderType === "guest" &&
		initialMessage.senderType === "guest" &&
		message.body === initialMessage.body
	);
}

function reconcileInitialMessages(
	current: UiMessage[],
	initialMessages: ConversationMessageDto[],
	conversationId: string | null,
): UiMessage[] {
	const sourceMessages: UiMessage[] = initialMessages.map((message) => ({
		...message,
		localOnly: false,
	}));
	const sourceIds = new Set(sourceMessages.map((message) => message.id));
	const sourceExternalIds = new Set(
		sourceMessages
			.map((message) => message.externalMessageId)
			.filter((id): id is string => id !== null),
	);
	const currentById = new Map(current.map((message) => [message.id, message]));
	const mergedSource = sourceMessages.map((message) => {
		const existing = currentById.get(message.id);
		if (
			existing?.deliveryStatus === "sent" &&
			message.deliveryStatus === "pending"
		) {
			return existing;
		}
		return message;
	});
	const preservedCurrent = current.filter((message) => {
		if (
			message.conversationId !== conversationId ||
			sourceIds.has(message.id)
		) {
			return false;
		}
		if (
			message.externalMessageId &&
			sourceExternalIds.has(message.externalMessageId)
		) {
			return false;
		}
		if (
			sourceMessages.some((sourceMessage) =>
				isSameOptimisticGuestMessage(message, sourceMessage),
			)
		) {
			return false;
		}
		return true;
	});
	const next = sortBySentAt([...mergedSource, ...preservedCurrent]);
	return sameMessages(current, next) ? current : next;
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

function formatTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : format(date, "p");
}

function MessageBubble({
	message,
	mounted,
	onRetry,
}: {
	message: UiMessage;
	mounted: boolean;
	onRetry: (message: UiMessage) => void;
}) {
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
					<span suppressHydrationWarning>
						{mounted ? formatTime(message.sentAt) : ""}
					</span>
				)}
			</div>
		</div>
	);
}

interface MessageGroupData {
	automated: boolean;
	key: string;
	messages: UiMessage[];
	senderType: ConversationMessageDto["senderType"];
}

// Collapse consecutive messages from the same author into one group so the
// identity row (avatar + name) renders once per run instead of per bubble. Host
// runs are also split on `isAutomatic` so the "Automated" tag never mislabels a
// personal reply, and system notices never merge with anything.
function groupMessages(messages: UiMessage[]): MessageGroupData[] {
	const groups: MessageGroupData[] = [];
	for (const message of messages) {
		const last = groups.at(-1);
		const automated = message.senderType === "host" && message.isAutomatic;
		if (
			last &&
			last.senderType === message.senderType &&
			message.senderType !== "system" &&
			last.automated === automated
		) {
			last.messages.push(message);
		} else {
			groups.push({
				automated,
				key: message.id,
				messages: [message],
				senderType: message.senderType,
			});
		}
	}
	return groups;
}

function MessageGroup({
	group,
	mounted,
	onRetry,
}: {
	group: MessageGroupData;
	mounted: boolean;
	onRetry: (message: UiMessage) => void;
}) {
	if (group.senderType === "system") {
		return (
			<>
				{group.messages.map((message) => (
					<p
						className="mx-auto max-w-[80%] text-center text-muted-foreground text-xs"
						key={message.id}
					>
						{message.body}
					</p>
				))}
			</>
		);
	}

	const isGuest = group.senderType === "guest";

	return (
		<div
			className={cn(
				"flex flex-col gap-1",
				isGuest ? "items-end" : "items-start",
			)}
		>
			<div
				className={cn(
					"flex items-center gap-1.5",
					isGuest && "flex-row-reverse",
				)}
			>
				<Avatar size="sm">
					{isGuest ? (
						<AvatarFallback>
							<User className="size-3" />
						</AvatarFallback>
					) : (
						<>
							<AvatarImage alt={HOST_NAME} src={HOST_AVATAR_SRC} />
							<AvatarFallback>AI</AvatarFallback>
						</>
					)}
				</Avatar>
				<span className="font-medium text-foreground text-xs">
					{isGuest ? "You" : HOST_NAME}
				</span>
				{group.automated && (
					<Badge className="h-4 px-1.5 font-normal" variant="outline">
						Automated
					</Badge>
				)}
			</div>
			{group.messages.map((message) => (
				<MessageBubble
					key={message.id}
					message={message}
					mounted={mounted}
					onRetry={onRetry}
				/>
			))}
		</div>
	);
}

function emptyStateCopy(availability: OrderConversationAvailability): string {
	if (availability === "pending") {
		return "Your conversation with the Alojamento Ideal team opens once your booking is confirmed.";
	}
	if (availability === "available") {
		return "We're opening your conversation with the Alojamento Ideal team. This page will update automatically.";
	}
	return "Messaging will be available once your booking is confirmed.";
}

export function OrderMessages({
	availability,
	channelName,
	conversationId,
	initialMessages,
	messagesLoadError,
	reference,
}: {
	availability: OrderConversationAvailability;
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
	const [mounted, setMounted] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const router = useRouter();

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		setMessages((current) =>
			reconcileInitialMessages(current, initialMessages, conversationId),
		);
	}, [conversationId, initialMessages]);

	const canSend =
		availability === "available" &&
		conversationId !== null &&
		!messagesLoadError;

	const { socketIdRef } = useOrderConversation({
		channelName,
		enabled: conversationId !== null && !messagesLoadError,
		onMessage: (incoming) => {
			setMessages((current) => {
				// Same row we already hold: apply status/content transitions in place so
				// other viewers move a message from "Sending…" to sent. Never regress an
				// already-delivered message back to pending on a late-arriving echo.
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
						(message) =>
							message.externalMessageId === incoming.externalMessageId,
					)
				) {
					return current;
				}
				// Belt-and-suspenders for the sender's own echo if socket exclusion did
				// not apply (e.g. the connection had no socket id yet): reconcile the
				// echo with the optimistic bubble we already rendered instead of adding a
				// duplicate. Server-side socket exclusion handles the common case.
				if (incoming.senderType === "guest") {
					const optimisticMatches: number[] = [];
					for (const [index, message] of current.entries()) {
						if (message.localOnly && message.body === incoming.body) {
							optimisticMatches.push(index);
						}
					}
					if (
						optimisticMatches.length === 1 &&
						optimisticMatches[0] !== undefined
					) {
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
			});
		},
		reference,
	});

	// The conversation is provisioned asynchronously: only once the booking is
	// confirmed and its provider thread exists does the reconcile job link it to
	// the order. Until the server hands us a conversation id, poll for it so the
	// thread opens on its own instead of waiting for a manual reload.
	// `router.refresh()` re-runs the page and re-passes the (now present) props,
	// which stops this effect and enables the realtime subscription.
	useEffect(() => {
		if (conversationId !== null || availability === "unavailable") {
			return;
		}
		const interval = setInterval(() => {
			router.refresh();
		}, 10000);
		return () => clearInterval(interval);
	}, [availability, conversationId, router]);

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
				socketIdRef.current,
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
				socketIdRef.current,
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
				{messagesLoadError ? (
					<div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
						<AlertCircle
							aria-hidden="true"
							className="size-5 text-destructive"
						/>
						<p className="text-muted-foreground text-sm leading-relaxed">
							There was a problem loading your messages. Please come back in a
							few minutes.
						</p>
					</div>
				) : messages.length === 0 ? (
					<p className="m-auto text-center text-muted-foreground text-sm">
						No messages yet. Say hello to start the conversation.
					</p>
				) : (
					groupMessages(messages).map((group) => (
						<MessageGroup
							group={group}
							key={group.key}
							mounted={mounted}
							onRetry={handleRetry}
						/>
					))
				)}
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			{messagesLoadError ? null : canSend ? (
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
