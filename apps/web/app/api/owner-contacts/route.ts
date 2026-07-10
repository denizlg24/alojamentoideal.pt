import {
	createPropertyOwnerContact,
	markPropertyOwnerContactNotification,
	propertyOwnerContactInputSchema,
} from "@workspace/core/owner";
import { getRuntimeSettings } from "@workspace/core/settings";
import { withApiRoute } from "@/lib/api/route";
import { sendPropertyOwnerContactEmail } from "@/lib/owner/email";

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

export const POST = withApiRoute(
	{
		name: "owner_contacts.create",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request): Promise<Response> => {
		const parsed = propertyOwnerContactInputSchema.safeParse(
			await readJson(request),
		);
		if (!parsed.success) {
			return Response.json(
				{ error: "Please check the details in the form and try again." },
				{ status: 400 },
			);
		}

		const contact = await createPropertyOwnerContact(parsed.data);
		const settings = await getRuntimeSettings();
		const recipient = settings["communications.ownerContactEmail"];

		try {
			if (typeof recipient !== "string" || !recipient) {
				throw new Error("Property-owner enquiry inbox is not configured");
			}
			await sendPropertyOwnerContactEmail(contact, recipient);
			await markPropertyOwnerContactNotification(contact.id, {
				sentAt: new Date(),
			});
		} catch {
			await markPropertyOwnerContactNotification(contact.id, {
				error: "Notification delivery failed",
			});
		}

		return Response.json({ success: true }, { status: 201 });
	},
);
