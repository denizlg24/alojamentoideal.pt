import { cors } from "@elysiajs/cors";
import { auth } from "@workspace/auth";
import { Elysia } from "elysia";

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3001")
	.split(",")
	.map((origin) => origin.trim())
	.filter((origin) => origin.length > 0);

/**
 * Elysia plugin that exposes Better Auth as the single auth origin:
 * - CORS so the Next.js web app can call it with credentials,
 * - the Better Auth handler mounted at `/api/auth/*`,
 * - an `auth` macro that resolves the session and 401s unauthenticated routes.
 */
export const betterAuth = new Elysia({ name: "better-auth" })
	.use(
		cors({
			origin: webOrigins,
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
	.mount(auth.handler)
	.macro({
		auth: {
			async resolve({ status, request: { headers } }) {
				const session = await auth.api.getSession({ headers });

				if (!session) {
					return status(401);
				}

				return {
					session: session.session,
					user: session.user,
				};
			},
		},
	});
