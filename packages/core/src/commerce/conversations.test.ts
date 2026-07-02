import { describe, expect, test } from "bun:test";
import type { HostifyClient } from "../integrations/hostify";
import {
	conversationChannelName,
	HostifyConversationGateway,
	normalizeConversationPreview,
	parseConversationChannelName,
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
		const channelName = conversationChannelName("order-1", "conv-2");
		expect(channelName).toBe("private-order.b3JkZXItMQ.conv.Y29udi0y");
		expect(parseConversationChannelName(channelName)).toEqual({
			conversationId: "conv-2",
			orderId: "order-1",
		});
	});

	test("channel names preserve ambiguous raw delimiters", () => {
		const first = conversationChannelName("a", "b-conv-c");
		const second = conversationChannelName("a-conv-b", "c");
		expect(first).not.toBe(second);
		expect(parseConversationChannelName(first)).toEqual({
			conversationId: "b-conv-c",
			orderId: "a",
		});
		expect(parseConversationChannelName(second)).toEqual({
			conversationId: "c",
			orderId: "a-conv-b",
		});
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

	test("does not link an unrelated first thread", async () => {
		const client = {
			inbox: {
				list: async () => ({
					success: true,
					threads: [
						{
							id: 123,
							is_archived: 0,
							last_message: "Wrong reservation",
							reservation_id: 999,
						},
					],
				}),
			},
		} as unknown as HostifyClient;

		const thread = await new HostifyConversationGateway({
			client,
		}).findThreadForReservation("456");

		expect(thread).toBeNull();
	});

	test("classifies sender by thread guest and filters empty or undated rows", async () => {
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
							guest_id: 99,
							id: "m2",
							is_automatic: 1,
							message: "Host reply",
						},
						{ id: "m3", message: "   " },
						{ id: "m4", message: "Undated" },
						{ created: "not-a-date", id: "m5", message: "Invalid date" },
					],
					success: true,
					thread: {
						channel_unread: 2,
						guest_id: 42,
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
					guest_id: 99,
					id: "m2",
					is_automatic: 1,
					message: "Host reply",
				},
				senderType: "host",
				sentAt: new Date("2026-06-29T10:01:00.000Z"),
			},
		]);
	});

	test("reads designator-less provider timestamps as UTC", async () => {
		const client = {
			inbox: {
				get: async () => ({
					messages: [
						{
							created: "2026-06-30 05:21:00",
							guest_id: 42,
							id: "m1",
							message: "Naive timestamp",
						},
					],
					success: true,
					thread: { guest_id: 42, id: "thread-1" },
				}),
			},
		} as unknown as HostifyClient;

		const snapshot = await new HostifyConversationGateway({
			client,
		}).getThread("thread-1");

		expect(snapshot.messages[0]?.sentAt).toEqual(
			new Date("2026-06-30T05:21:00.000Z"),
		);
	});

	test("delivers guest messages as the guest with our channel message id", async () => {
		const calls: unknown[] = [];
		const client = {
			inbox: {
				receiveReply: async (input: unknown) => {
					calls.push(input);
					return { id: 789, success: true };
				},
			},
		} as unknown as HostifyClient;

		const id = await new HostifyConversationGateway({ client }).sendMessage(
			"thread-1",
			"Hello",
			"local-row-1",
		);

		expect(id).toBe("789");
		expect(calls).toEqual([
			{
				channel_message_id: "local-row-1",
				message: "Hello",
				sent_by: "guest",
				thread_id: "thread-1",
			},
		]);
	});
});
