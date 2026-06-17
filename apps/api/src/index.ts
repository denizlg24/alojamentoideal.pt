import { Elysia, t } from "elysia";
import { betterAuth } from "./auth.js";

const healthResponse = t.Object({
	service: t.Literal("api"),
	status: t.Literal("ok"),
});

export function createApp() {
	return new Elysia({ name: "api" })
		.use(betterAuth)
		.get("/", () => "Hello Elysia")
		.get(
			"/health",
			() => ({
				service: "api" as const,
				status: "ok" as const,
			}),
			{
				response: healthResponse,
			},
		)
		.get(
			"/ready",
			() => ({
				service: "api" as const,
				status: "ok" as const,
			}),
			{
				response: healthResponse,
			},
		)
		.get("/me", ({ user }) => user, { auth: true });
}

const app = createApp();

export type ApiApp = ReturnType<typeof createApp>;
export default app;
