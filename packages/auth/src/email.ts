import { Resend } from "resend";
import { type EmailConfig, getAuthConfig } from "./config";

const APP_NAME = "Alojamento Ideal";
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Escapes HTML-significant characters before interpolating a value into an email
 * body. better-auth builds these URLs internally today; this is defense in depth
 * for the day a URL carries user-controlled or special characters.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function verifiedRecipient(email: string): string {
	const recipient = email.trim();
	if (!EMAIL_ADDRESS_PATTERN.test(recipient)) {
		throw new Error("Cannot send auth email to an invalid address");
	}
	return recipient;
}

/**
 * Rendered email body. Template builders return this shape so brand HTML
 * (built later with Maizzle) can replace the inline bodies without touching any
 * call site.
 */
export interface EmailMessage {
	html: string;
	subject: string;
	text: string;
}

export interface OutboundEmail extends EmailMessage {
	to: string;
}

/**
 * Transport seam for transactional auth email. Swap the implementation (SES, a
 * queue, a test double) without changing the senders below.
 */
export interface EmailSender {
	send(email: OutboundEmail): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
	async send(email: OutboundEmail): Promise<void> {
		const recipientDomain = email.to.includes("@")
			? email.to.split("@").at(-1)
			: "unknown";
		console.info("[auth] email queued via console transport", {
			recipientDomain,
			subject: email.subject,
		});
	}
}

class ResendEmailSender implements EmailSender {
	readonly #client: Resend;
	readonly #from: string;

	constructor(apiKey: string, from: string) {
		this.#client = new Resend(apiKey);
		this.#from = from;
	}

	async send(email: OutboundEmail): Promise<void> {
		const { error } = await this.#client.emails.send({
			from: this.#from,
			html: email.html,
			subject: email.subject,
			text: email.text,
			to: email.to,
		});

		if (error) {
			throw new Error(`Resend failed to send email: ${error.message}`);
		}
	}
}

function createEmailSender(email: EmailConfig): EmailSender {
	return email.resendApiKey
		? new ResendEmailSender(email.resendApiKey, email.from)
		: new ConsoleEmailSender();
}

function emailSender(): EmailSender {
	return createEmailSender(getAuthConfig().email);
}

/**
 * Resolves the configured transactional email transport (Resend in production,
 * a console logger otherwise). Exposed so other packages can compose their own
 * transactional emails (e.g. order confirmations) without re-deriving the
 * transport or its `from` address.
 */
export function getEmailSender(): EmailSender {
	return emailSender();
}

interface EmailTemplates {
	verificationHtml?: string;
	verificationText?: string;
	passwordResetHtml?: string;
	passwordResetText?: string;
	orderConfirmationHtml?: string;
	orderConfirmationText?: string;
	orderPendingConfirmationHtml?: string;
	orderPendingConfirmationText?: string;
	orderCouldNotConfirmHtml?: string;
	orderCouldNotConfirmText?: string;
	orderAmountMismatchRefundHtml?: string;
	orderAmountMismatchRefundText?: string;
	orderInviteHtml?: string;
	orderInviteText?: string;
}

async function loadTemplates(): Promise<EmailTemplates> {
	try {
		return { ...(await import("@workspace/emails")) };
	} catch {
		return {};
	}
}

const TEMPLATES: EmailTemplates = await loadTemplates();

const CURRENT_YEAR = new Date().getFullYear().toString();

function applyPlaceholders(
	template: string,
	replacements: Record<string, string>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(replacements)) {
		result = result.split(`__${key}__`).join(value);
	}
	return result;
}

export function buildVerificationEmail({ url }: { url: string }): EmailMessage {
	const safeUrl = escapeHtml(url);

	if (TEMPLATES.verificationHtml) {
		const html = applyPlaceholders(TEMPLATES.verificationHtml, {
			APP_NAME,
			VERIFY_URL: safeUrl,
			CURRENT_YEAR,
		});
		const text = TEMPLATES.verificationText
			? applyPlaceholders(TEMPLATES.verificationText, {
					APP_NAME,
					VERIFY_URL: url,
					CURRENT_YEAR,
				})
			: `Welcome to ${APP_NAME}.\n\nConfirm your email address to finish setting up your account:\n${url}\n\nIf you did not create an account, you can ignore this message.`;

		return {
			html,
			subject: `Verify your ${APP_NAME} email`,
			text,
		};
	}

	return {
		html: `<p>Welcome to ${APP_NAME}.</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${safeUrl}">Verify email</a></p><p>If you did not create an account, you can ignore this message.</p>`,
		subject: `Verify your ${APP_NAME} email`,
		text: `Welcome to ${APP_NAME}.\n\nConfirm your email address to finish setting up your account:\n${url}\n\nIf you did not create an account, you can ignore this message.`,
	};
}

export function buildResetPasswordEmail({
	url,
}: {
	url: string;
}): EmailMessage {
	const safeUrl = escapeHtml(url);

	if (TEMPLATES.passwordResetHtml) {
		const html = applyPlaceholders(TEMPLATES.passwordResetHtml, {
			APP_NAME,
			RESET_URL: safeUrl,
			CURRENT_YEAR,
		});
		const text = TEMPLATES.passwordResetText
			? applyPlaceholders(TEMPLATES.passwordResetText, {
					APP_NAME,
					RESET_URL: url,
					CURRENT_YEAR,
				})
			: `We received a request to reset your ${APP_NAME} password.\n\nChoose a new password:\n${url}\n\nIf you did not request this, you can safely ignore this email.`;

		return {
			html,
			subject: `Reset your ${APP_NAME} password`,
			text,
		};
	}

	return {
		html: `<p>We received a request to reset your ${APP_NAME} password.</p><p><a href="${safeUrl}">Choose a new password</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
		subject: `Reset your ${APP_NAME} password`,
		text: `We received a request to reset your ${APP_NAME} password.\n\nChoose a new password:\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
	};
}

export interface OrderConfirmationEmailInput {
	email: string;
	orderNumber: string;
	accommodationTitle: string;
	accommodationImage: string;
	checkIn: string;
	checkOut: string;
	guests: string;
	totalPrice: string;
	paymentMethod: string;
	cardLastFour?: string;
	contactEmail: string;
	contactPhone: string;
	billingAddress: string;
	manageUrl: string;
}

function safeSubjectPart(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildOrderConfirmationEmail(
	input: OrderConfirmationEmailInput,
): EmailMessage {
	const safeTitleForSubject = safeSubjectPart(input.accommodationTitle);
	const safeUrl = escapeHtml(input.manageUrl);
	const cardInfo = input.cardLastFour ? ` ending in ${input.cardLastFour}` : "";
	const safeCardInfo = escapeHtml(cardInfo);

	if (TEMPLATES.orderConfirmationHtml) {
		const html = applyPlaceholders(TEMPLATES.orderConfirmationHtml, {
			APP_NAME,
			ORDER_NUMBER: escapeHtml(input.orderNumber),
			ACCOMMODATION_TITLE: escapeHtml(input.accommodationTitle),
			ACCOMMODATION_IMAGE: escapeHtml(input.accommodationImage),
			CHECK_IN: escapeHtml(input.checkIn),
			CHECK_OUT: escapeHtml(input.checkOut),
			GUESTS: escapeHtml(input.guests),
			TOTAL_PRICE: escapeHtml(input.totalPrice),
			PAYMENT_METHOD: escapeHtml(input.paymentMethod),
			CARD_LAST_FOUR: safeCardInfo,
			CONTACT_EMAIL: escapeHtml(input.contactEmail),
			CONTACT_PHONE: escapeHtml(input.contactPhone),
			BILLING_ADDRESS: escapeHtml(input.billingAddress),
			MANAGE_URL: safeUrl,
			CURRENT_YEAR,
		});
		const text = TEMPLATES.orderConfirmationText
			? applyPlaceholders(TEMPLATES.orderConfirmationText, {
					APP_NAME,
					ORDER_NUMBER: input.orderNumber,
					ACCOMMODATION_TITLE: input.accommodationTitle,
					ACCOMMODATION_IMAGE: input.accommodationImage,
					CHECK_IN: input.checkIn,
					CHECK_OUT: input.checkOut,
					GUESTS: input.guests,
					TOTAL_PRICE: input.totalPrice,
					PAYMENT_METHOD: input.paymentMethod,
					CARD_LAST_FOUR: cardInfo,
					CONTACT_EMAIL: input.contactEmail,
					CONTACT_PHONE: input.contactPhone,
					BILLING_ADDRESS: input.billingAddress,
					MANAGE_URL: input.manageUrl,
					CURRENT_YEAR,
				})
			: `Booking confirmed at ${safeTitleForSubject}!\n\nReservation code: ${input.orderNumber}\n\n${input.checkIn} to ${input.checkOut}\n${input.guests}\n\nTotal: ${input.totalPrice}\nPayment: ${input.paymentMethod}${cardInfo}\n\nManage: ${input.manageUrl}`;

		return {
			html,
			subject: `Booking confirmed at ${safeTitleForSubject}`,
			text,
		};
	}

	return {
		html: `<p>Booking confirmed at ${escapeHtml(input.accommodationTitle)}!</p><p>Reservation code: ${escapeHtml(input.orderNumber)}</p><p>Check-in: ${escapeHtml(input.checkIn)}<br>Check-out: ${escapeHtml(input.checkOut)}<br>Guests: ${escapeHtml(input.guests)}</p><p>Total: ${escapeHtml(input.totalPrice)}<br>Payment: ${escapeHtml(input.paymentMethod)}${escapeHtml(cardInfo)}</p><p><a href="${safeUrl}">Manage reservation</a></p>`,
		subject: `Booking confirmed at ${input.accommodationTitle}`,
		text: `Booking confirmed at ${input.accommodationTitle}!\n\nReservation code: ${input.orderNumber}\n\nCheck-in: ${input.checkIn}\nCheck-out: ${input.checkOut}\nGuests: ${input.guests}\n\nTotal: ${input.totalPrice}\nPayment: ${input.paymentMethod}${cardInfo}\n\nManage: ${input.manageUrl}`,
	};
}

/**
 * Builds the "payment received, we're finalizing your booking" email sent while
 * an order sits paid but not yet confirmed (the provider hold has not settled).
 * Carries the same booking details as the confirmation email plus a link to the
 * order page so the guest can track status. Text-first today; the branded HTML
 * template can drop in later via `orderPendingConfirmationHtml` without touching
 * any call site.
 */
export function buildOrderPendingConfirmationEmail(
	input: OrderConfirmationEmailInput,
): EmailMessage {
	const safeTitleForSubject = safeSubjectPart(input.accommodationTitle);
	const cardInfo = input.cardLastFour ? ` ending in ${input.cardLastFour}` : "";
	const subject = `Payment received for ${safeTitleForSubject}: finalizing your booking`;

	if (TEMPLATES.orderPendingConfirmationHtml) {
		const html = applyPlaceholders(TEMPLATES.orderPendingConfirmationHtml, {
			APP_NAME,
			ORDER_NUMBER: escapeHtml(input.orderNumber),
			ACCOMMODATION_TITLE: escapeHtml(input.accommodationTitle),
			ACCOMMODATION_IMAGE: escapeHtml(input.accommodationImage),
			CHECK_IN: escapeHtml(input.checkIn),
			CHECK_OUT: escapeHtml(input.checkOut),
			GUESTS: escapeHtml(input.guests),
			TOTAL_PRICE: escapeHtml(input.totalPrice),
			PAYMENT_METHOD: escapeHtml(input.paymentMethod),
			CARD_LAST_FOUR: escapeHtml(cardInfo),
			CONTACT_EMAIL: escapeHtml(input.contactEmail),
			CONTACT_PHONE: escapeHtml(input.contactPhone),
			BILLING_ADDRESS: escapeHtml(input.billingAddress),
			MANAGE_URL: escapeHtml(input.manageUrl),
			CURRENT_YEAR,
		});
		const text = TEMPLATES.orderPendingConfirmationText
			? applyPlaceholders(TEMPLATES.orderPendingConfirmationText, {
					APP_NAME,
					ORDER_NUMBER: input.orderNumber,
					ACCOMMODATION_TITLE: input.accommodationTitle,
					ACCOMMODATION_IMAGE: input.accommodationImage,
					CHECK_IN: input.checkIn,
					CHECK_OUT: input.checkOut,
					GUESTS: input.guests,
					TOTAL_PRICE: input.totalPrice,
					PAYMENT_METHOD: input.paymentMethod,
					CARD_LAST_FOUR: cardInfo,
					CONTACT_EMAIL: input.contactEmail,
					CONTACT_PHONE: input.contactPhone,
					BILLING_ADDRESS: input.billingAddress,
					MANAGE_URL: input.manageUrl,
					CURRENT_YEAR,
				})
			: orderPendingConfirmationFallbackText(input, cardInfo);
		return { html, subject, text };
	}

	const text = orderPendingConfirmationFallbackText(input, cardInfo);
	return { html: plainCompensationHtml(text), subject, text };
}

function orderPendingConfirmationFallbackText(
	input: OrderConfirmationEmailInput,
	cardInfo: string,
): string {
	return [
		`We've received your payment for ${input.accommodationTitle}.`,
		"",
		`Reservation code: ${input.orderNumber}`,
		"",
		"We're finalizing your booking now and will email you a full confirmation as soon as it's secured. You can track its status any time here:",
		input.manageUrl,
		"",
		`Check-in: ${input.checkIn}`,
		`Check-out: ${input.checkOut}`,
		`Guests: ${input.guests}`,
		"",
		`Total paid: ${input.totalPrice}`,
		`Payment: ${input.paymentMethod}${cardInfo}`,
		"",
		`The ${APP_NAME} team`,
	].join("\n");
}

export interface OrderCompensationEmailInput {
	/** Pre-built greeting line, e.g. "Hi Ana," or "Hi there,". */
	greeting: string;
	orderNumber: string;
	/** Formatted refund amount, e.g. "€640.00". */
	refundAmount: string;
	/** Link guests can use to start a fresh booking (e.g. the homes index). */
	browseUrl: string;
}

function compensationPlaceholders(
	input: OrderCompensationEmailInput,
	transform: (value: string) => string,
): Record<string, string> {
	return {
		APP_NAME,
		BROWSE_URL: transform(input.browseUrl),
		CURRENT_YEAR,
		GREETING: transform(input.greeting),
		ORDER_NUMBER: transform(input.orderNumber),
		REFUND_AMOUNT: transform(input.refundAmount),
	};
}

const identity = (value: string): string => value;

/**
 * Builds the "we couldn't confirm your booking, so you've been refunded" email
 * for the post-charge compensation path. Uses the branded template when the
 * emails package is present, falling back to a plain body otherwise.
 */
export function buildOrderCouldNotConfirmEmail(
	input: OrderCompensationEmailInput,
): EmailMessage {
	const subject = `We couldn't confirm booking ${safeSubjectPart(input.orderNumber)}: full refund issued`;

	if (TEMPLATES.orderCouldNotConfirmHtml) {
		const html = applyPlaceholders(
			TEMPLATES.orderCouldNotConfirmHtml,
			compensationPlaceholders(input, escapeHtml),
		);
		const text = TEMPLATES.orderCouldNotConfirmText
			? applyPlaceholders(
					TEMPLATES.orderCouldNotConfirmText,
					compensationPlaceholders(input, identity),
				)
			: orderCouldNotConfirmFallbackText(input);
		return { html, subject, text };
	}

	const text = orderCouldNotConfirmFallbackText(input);
	return { html: plainCompensationHtml(text), subject, text };
}

/**
 * Builds the refund email for a Stripe amount/currency mismatch: the captured
 * payment did not match the order total, so it was cancelled and refunded.
 */
export function buildOrderAmountMismatchRefundEmail(
	input: OrderCompensationEmailInput,
): EmailMessage {
	const subject = `Refund issued for booking ${safeSubjectPart(input.orderNumber)}`;

	if (TEMPLATES.orderAmountMismatchRefundHtml) {
		const html = applyPlaceholders(
			TEMPLATES.orderAmountMismatchRefundHtml,
			compensationPlaceholders(input, escapeHtml),
		);
		const text = TEMPLATES.orderAmountMismatchRefundText
			? applyPlaceholders(
					TEMPLATES.orderAmountMismatchRefundText,
					compensationPlaceholders(input, identity),
				)
			: orderAmountMismatchFallbackText(input);
		return { html, subject, text };
	}

	const text = orderAmountMismatchFallbackText(input);
	return { html: plainCompensationHtml(text), subject, text };
}

function orderCouldNotConfirmFallbackText(
	input: OrderCompensationEmailInput,
): string {
	return [
		input.greeting,
		"",
		`We're sorry: we were unable to confirm booking ${input.orderNumber} for your stay, so we have cancelled it and are refunding you in full.`,
		`A full refund of ${input.refundAmount} is on its way back to your original payment method. It can take a few business days to appear, depending on your bank.`,
		"",
		`If you'd still like to stay with us, you can start a fresh booking at ${input.browseUrl}, or just reply to this email and we'll help.`,
		"",
		`The ${APP_NAME} team`,
	].join("\n");
}

function orderAmountMismatchFallbackText(
	input: OrderCompensationEmailInput,
): string {
	return [
		input.greeting,
		"",
		`We received a payment for booking ${input.orderNumber}, but the charged amount did not match the booking total. We have cancelled that payment and issued a full refund.`,
		`A full refund of ${input.refundAmount} is on its way back to your original payment method. It can take a few business days to appear, depending on your bank.`,
		"",
		`If you'd still like to stay with us, you can try booking again at ${input.browseUrl}, or just reply to this email and we'll help.`,
		"",
		`The ${APP_NAME} team`,
	].join("\n");
}

function plainCompensationHtml(text: string): string {
	const paragraphs = text
		.split("\n")
		.map((line) => (line === "" ? "<br/>" : `<p>${escapeHtml(line)}</p>`))
		.join("");
	return `<div style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs}</div>`;
}

function orderInviteFallbackHtml(input: OrderInviteEmailInput): string {
	return `<div style="font-family:system-ui,sans-serif;line-height:1.5"><p>Hi,</p><p>You've been invited to join booking ${escapeHtml(input.orderNumber)} for ${escapeHtml(input.accommodationTitle)} with ${APP_NAME}.</p><p><a href="${escapeHtml(input.inviteUrl)}">Open your booking</a> to message us and add your guest details.</p><p>This invitation link expires in ${input.expiresInHours} hours. If it lapses, ask whoever booked to resend it.</p><p>The ${APP_NAME} team</p></div>`;
}

export interface OrderInviteEmailInput {
	/** Property name for the subject and body, e.g. "Sunny Loft in Porto". */
	accommodationTitle: string;
	/** Public order reference, e.g. "AI-XK4P". */
	orderNumber: string;
	/** Magic-link into the order hub carrying the single-use invite token. */
	inviteUrl: string;
	/** Whole hours until the invite lapses (24 today). */
	expiresInHours: number;
}

/**
 * Builds the "you've been invited to a booking" email carrying the order-hub
 * magic-link. Uses the branded template when the emails package ships one,
 * falling back to a plain body otherwise (same degrade path as the other order
 * emails). The link is a bearer credential, so the body states the short expiry.
 */
export function buildOrderInviteEmail(
	input: OrderInviteEmailInput,
): EmailMessage {
	const safeTitle = safeSubjectPart(input.accommodationTitle);
	const subject = `You're invited to booking ${safeSubjectPart(input.orderNumber)} at ${safeTitle}`;

	if (TEMPLATES.orderInviteHtml) {
		const html = applyPlaceholders(TEMPLATES.orderInviteHtml, {
			ACCOMMODATION_TITLE: escapeHtml(input.accommodationTitle),
			APP_NAME,
			CURRENT_YEAR,
			EXPIRES_IN_HOURS: input.expiresInHours.toString(),
			INVITE_URL: escapeHtml(input.inviteUrl),
			ORDER_NUMBER: escapeHtml(input.orderNumber),
		});
		const text = TEMPLATES.orderInviteText
			? applyPlaceholders(TEMPLATES.orderInviteText, {
					ACCOMMODATION_TITLE: input.accommodationTitle,
					APP_NAME,
					CURRENT_YEAR,
					EXPIRES_IN_HOURS: input.expiresInHours.toString(),
					INVITE_URL: input.inviteUrl,
					ORDER_NUMBER: input.orderNumber,
				})
			: orderInviteFallbackText(input);
		return { html, subject, text };
	}

	const text = orderInviteFallbackText(input);
	return { html: orderInviteFallbackHtml(input), subject, text };
}

function orderInviteFallbackText(input: OrderInviteEmailInput): string {
	return [
		"Hi,",
		"",
		`You've been invited to join booking ${input.orderNumber} for ${input.accommodationTitle} with ${APP_NAME}.`,
		`Open your booking to message us and add your guest details: ${input.inviteUrl}`,
		"",
		`This invitation link expires in ${input.expiresInHours} hours. If it lapses, ask whoever booked to resend it.`,
		"",
		`The ${APP_NAME} team`,
	].join("\n");
}

export interface VerificationEmail {
	email: string;
	url: string;
}

export async function sendVerificationEmail({
	email,
	url,
}: VerificationEmail): Promise<void> {
	await emailSender().send({
		to: verifiedRecipient(email),
		...buildVerificationEmail({ url }),
	});
}

export interface ResetPasswordEmail {
	email: string;
	url: string;
}

export async function sendResetPasswordEmail({
	email,
	url,
}: ResetPasswordEmail): Promise<void> {
	await emailSender().send({
		to: verifiedRecipient(email),
		...buildResetPasswordEmail({ url }),
	});
}
