import { Resend } from "resend";
import { type EmailConfig, getAuthConfig } from "./config";

const APP_NAME = "Alojamento Ideal";

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
		console.info(
			`[auth] email to ${email.to}: ${email.subject}\n${email.text}`,
		);
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

export function buildVerificationEmail({ url }: { url: string }): EmailMessage {
	return {
		html: `<p>Welcome to ${APP_NAME}.</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${url}">Verify email</a></p><p>If you did not create an account, you can ignore this message.</p>`,
		subject: `Verify your ${APP_NAME} email`,
		text: `Welcome to ${APP_NAME}.\n\nConfirm your email address to finish setting up your account:\n${url}\n\nIf you did not create an account, you can ignore this message.`,
	};
}

export function buildResetPasswordEmail({
	url,
}: {
	url: string;
}): EmailMessage {
	return {
		html: `<p>We received a request to reset your ${APP_NAME} password.</p><p><a href="${url}">Choose a new password</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
		subject: `Reset your ${APP_NAME} password`,
		text: `We received a request to reset your ${APP_NAME} password.\n\nChoose a new password:\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
	};
}

export interface VerificationEmail {
	email: string;
	url: string;
}

export async function sendVerificationEmail({
	email,
	url,
}: VerificationEmail): Promise<void> {
	await emailSender().send({ to: email, ...buildVerificationEmail({ url }) });
}

export interface ResetPasswordEmail {
	email: string;
	url: string;
}

export async function sendResetPasswordEmail({
	email,
	url,
}: ResetPasswordEmail): Promise<void> {
	await emailSender().send({ to: email, ...buildResetPasswordEmail({ url }) });
}
