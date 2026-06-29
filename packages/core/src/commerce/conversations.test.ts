import { describe, expect, test } from "bun:test";
import type { HostifyClient } from "../integrations/hostify";
import {
	conversationChannelName,
	HostifyConversationGateway,
	normalizeConversationPreview,
	trimMessageBody,
} from "./conversations";

describe("conversation helpers", () => {
	test("trims message bodies for storage", () => {
		expect(trimMessageBody("  hello \n\n north   coast  ")).toBe(
			"hello north coast",
		);
	});

	test("normalizes long previews", () => {
		const preview = normalizeConversationPreview("x".repeat(220));
		expect(preview).toHaveLength(160);
		expect(preview.endsWith("...")).toBe(true);
	});

	test("builds private realtime channel names", () => {
		expect(conversationChannelName("order-1", "conv-2")).toBe(
			"private-order-order-1-conv-conv-2",
		);
	});
});

describe("HostifyConversationGateway", () => {
	test("finds a thread by reservation id", async () => {
		const client = {
			inbox: {
				list: async () => ({
					success: true,
					threads: [
						{
							id: 123,
							is_archived: 0,
							last_message: "Hello",
							reservation_id: 456,
						},
					],
				}),
			},
		} as unknown as HostifyClient;

		const thread = await new HostifyConversationGateway({
			client,
		}).findThreadForReservation("456");

		expect(thread).toEqual({
			externalThreadId: "123",
			lastMessagePreview: "Hello",
			raw: {
				id: 123,
				is_archived: 0,
				last_message: "Hello",
				reservation_id: 456,
			},
			status: "active",
			unreadCount: 0,
		});
	});

	test("maps thread messages and filters empty provider rows", async () => {
		const client = {
			inbox: {
				get: async () => ({
					messages: [
						{
							created: "2026-06-29T10:00:00.000Z",
							guest_id: 42,
							id: "m1",
							is_automatic: 0,
							message: " Guest reply ",
						},
						{
							created: "2026-06-29T10:01:00.000Z",
							id: "m2",
							is_automatic: 1,
							message: "Host reply",
						},
						{ id: "m3", message: "   " },
					],
					success: true,
					thread: {
						channel_unread: 2,
						id: "thread-1",
						is_archived: 0,
						preview: "Host reply",
					},
				}),
			},
		} as unknown as HostifyClient;

		const snapshot = await new HostifyConversationGateway({
			client,
		}).getThread("thread-1");

		expect(snapshot.thread.unreadCount).toBe(2);
		expect(snapshot.messages).toEqual([
			{
				body: "Guest reply",
				externalMessageId: "m1",
				isAutomatic: false,
				raw: {
					created: "2026-06-29T10:00:00.000Z",
					guest_id: 42,
					id: "m1",
					is_automatic: 0,
					message: " Guest reply ",
				},
				senderType: "guest",
				sentAt: new Date("2026-06-29T10:00:00.000Z"),
			},
			{
				body: "Host reply",
				externalMessageId: "m2",
				isAutomatic: true,
				raw: {
					created: "2026-06-29T10:01:00.000Z",
					id: "m2",
					is_automatic: 1,
					message: "Host reply",
				},
				senderType: "host",
				sentAt: new Date("2026-06-29T10:01:00.000Z"),
			},
		]);
	});

	test("sends guest replies by channel", async () => {
		const calls: unknown[] = [];
		const client = {
			inbox: {
				reply: async (input: unknown) => {
					calls.push(input);
					return { id: 789, success: true };
				},
			},
		} as unknown as HostifyClient;

		const id = await new HostifyConversationGateway({ client }).sendMessage(
			"thread-1",
			"Hello",
		);

		expect(id).toBe("789");
		expect(calls).toEqual([
			{ message: "Hello", send_by: "channel", thread_id: "thread-1" },
		]);
	});
});
