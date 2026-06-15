import { Elysia, t } from "elysia";

const healthResponse = t.Object({
	service: t.Literal("api"),
	status: t.Literal("ok"),
});

export function createApp() {
	return new Elysia({ name: "api" })
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
		);
}

export type ApiApp = ReturnType<typeof createApp>;
