import { describe, expect, it } from "bun:test";
import app from "./index.js";

describe("API app", () => {
	it("exports an unstarted Elysia app for Vercel", () => {
		expect(typeof app.fetch).toBe("function");
		expect(app.server).toBeNull();
	});

	it.each(["/health", "/ready"])("serves %s", async (path) => {
		const response = await app.handle(new Request(`http://localhost${path}`));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			service: "api",
			status: "ok",
		});
	});

	it("forwards Better Auth requests", async () => {
		const response = await app.handle(
			new Request("http://localhost/api/auth/get-session"),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toBeNull();
	});

	it("rejects Hostify listing cron requests without the cron secret", async () => {
		const originalSecret = process.env.HOSTIFY_SYNC_CRON_SECRET;
		process.env.HOSTIFY_SYNC_CRON_SECRET = "test-secret";

		try {
			const response = await app.handle(
				new Request("http://localhost/cron/hostify/listings", {
					method: "POST",
				}),
			);

			expect(response.status).toBe(401);
		} finally {
			if (originalSecret === undefined) {
				delete process.env.HOSTIFY_SYNC_CRON_SECRET;
			} else {
				process.env.HOSTIFY_SYNC_CRON_SECRET = originalSecret;
			}
		}
	});
});
