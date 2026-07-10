import { type EmailMessage, escapeHtml, getEmailSender } from "@workspace/auth";
import type { PropertyOwnerContact } from "@workspace/core/owner";

function contactMessage(contact: PropertyOwnerContact): string {
	return [
		`Full name: ${contact.fullName}`,
		`Email: ${contact.email}`,
		`Phone: ${contact.phoneNumber}`,
		`Property address: ${contact.propertyAddress}`,
		`Property location: ${contact.propertyLocation}`,
		`Number of properties: ${contact.propertyCount}`,
		`Number of bedrooms: ${contact.bedroomCount}`,
	].join("\n");
}

export function buildPropertyOwnerContactEmail(
	contact: PropertyOwnerContact,
): EmailMessage {
	const rows = [
		["Full name", contact.fullName],
		["Email", contact.email],
		["Phone", contact.phoneNumber],
		["Property address", contact.propertyAddress],
		["Property location", contact.propertyLocation],
		["Number of properties", String(contact.propertyCount)],
		["Number of bedrooms", String(contact.bedroomCount)],
	] as const;
	const subjectName = contact.fullName.replace(/[\r\n]+/g, " ").trim();
	const subject = `New property-owner enquiry from ${subjectName}`;

	return {
		html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2e2925"><h1 style="font-size:22px">New property-owner enquiry</h1><p>Someone would like to discuss having Alojamento Ideal manage their property.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="font-weight:bold;vertical-align:top">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}</table><p style="margin-top:24px;color:#665d55">Reply to ${escapeHtml(contact.email)} to continue the conversation.</p></div>`,
		subject,
		text: `New property-owner enquiry\n\n${contactMessage(contact)}\n\nReply to ${contact.email} to continue the conversation.`,
	};
}

export async function sendPropertyOwnerContactEmail(
	contact: PropertyOwnerContact,
	recipient: string,
): Promise<void> {
	await getEmailSender().send({
		to: recipient,
		...buildPropertyOwnerContactEmail(contact),
	});
}
