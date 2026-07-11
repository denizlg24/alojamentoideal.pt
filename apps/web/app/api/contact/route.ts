import {
	contactMessageInputSchema,
	createContactMessage,
	markContactMessageNotification,
} from "@workspace/core/contact";
import { getRuntimeSettings } from "@workspace/core/settings";
import { withApiRoute } from "@/lib/api/route";
import {
	sendContactConfirmationEmail,
	sendContactNotificationEmail,
} from "@/lib/contact/email";

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

export const POST = withApiRoute(
	{
		name: "contact.create",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request): Promise<Response> => {
		const parsed = contactMessageInputSchema.safeParse(await readJson(request));
		if (!parsed.success) {
			return Response.json(
				{ error: "Please check the details in the form and try again." },
				{ status: 400 },
			);
		}

		const message = await createContactMessage(parsed.data);
		const settings = await getRuntimeSettings();
		const recipient = settings["communications.generalContactEmail"];

		try {
			if (typeof recipient !== "string" || !recipient) {
				throw new Error("General contact inbox is not configured");
			}
			await sendContactNotificationEmail(message, recipient);
			await markContactMessageNotification(message.id, {
				sentAt: new Date(),
			});
		} catch {
			await markContactMessageNotification(message.id, {
				error: "Notification delivery failed",
			});
		}

		try {
			await sendContactConfirmationEmail(message);
		} catch {
			// Confirmation copy is best-effort; the message is stored and the
			// team was notified (or flagged) above.
		}

		return Response.json({ success: true }, { status: 201 });
	},
);
