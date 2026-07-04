import type { ConversationMessageDto } from "@workspace/core/commerce";

const seg = encodeURIComponent;

function base(reference: string, conversationId: string): string {
	return `/api/admin/orders/${seg(reference)}/conversations/${seg(
		conversationId,
	)}/messages`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		credentials: "same-origin",
		...init,
		headers: {
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error ?? "Request failed.");
	}
	return (await response.json()) as T;
}

export function readConversationMessages(
	reference: string,
	conversationId: string,
	limit = 100,
): Promise<{ messages: ConversationMessageDto[] }> {
	return request(`${base(reference, conversationId)}?limit=${limit}`);
}

export function sendConversationMessage(
	reference: string,
	conversationId: string,
	body: string,
	socketId: string | null,
): Promise<{ message: ConversationMessageDto }> {
	return request(base(reference, conversationId), {
		body: JSON.stringify({ body, socketId }),
		method: "POST",
	});
}
