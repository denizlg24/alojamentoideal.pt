import { type EmailMessage, escapeHtml, getEmailSender } from "@workspace/auth";
import type { ContactMessage } from "@workspace/core/contact";

function cleanSubjectPart(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildContactNotificationEmail(
	message: ContactMessage,
): EmailMessage {
	const rows = [
		["Name", message.name],
		["Email", message.email],
		["Subject", message.subject],
		["Message", message.message],
	] as const;
	const subject = `New contact message from ${cleanSubjectPart(message.name)}`;

	return {
		html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2e2925"><h1 style="font-size:22px">New contact message</h1><p>Someone sent a message through the help page on alojamentoideal.pt.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="font-weight:bold;vertical-align:top">${escapeHtml(label)}</td><td style="white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join("")}</table><p style="margin-top:24px;color:#665d55">Reply to ${escapeHtml(message.email)} to continue the conversation.</p></div>`,
		subject,
		text: `New contact message\n\nName: ${message.name}\nEmail: ${message.email}\nSubject: ${message.subject}\n\n${message.message}\n\nReply to ${message.email} to continue the conversation.`,
	};
}

export function buildContactConfirmationEmail(
	message: ContactMessage,
): EmailMessage {
	const subject = `We received your message: ${cleanSubjectPart(message.subject)}`;

	return {
		html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2e2925"><h1 style="font-size:22px">Thanks for reaching out</h1><p>Hi ${escapeHtml(message.name)},</p><p>We received your message about "${escapeHtml(message.subject)}" and will get back to you as soon as possible.</p><p>For reference, this is what you sent us:</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #d8d2cb;color:#665d55;white-space:pre-wrap">${escapeHtml(message.message)}</blockquote><p style="margin-top:24px;color:#665d55">Alojamento Ideal</p></div>`,
		subject,
		text: `Thanks for reaching out\n\nHi ${message.name},\n\nWe received your message about "${message.subject}" and will get back to you as soon as possible.\n\nFor reference, this is what you sent us:\n\n${message.message}\n\nAlojamento Ideal`,
	};
}

export async function sendContactNotificationEmail(
	message: ContactMessage,
	recipient: string,
): Promise<void> {
	await getEmailSender().send({
		to: recipient,
		...buildContactNotificationEmail(message),
	});
}

export async function sendContactConfirmationEmail(
	message: ContactMessage,
): Promise<void> {
	await getEmailSender().send({
		to: message.email,
		...buildContactConfirmationEmail(message),
	});
}
