import { Elysia } from "elysia";
import { betterAuth } from "./auth.js";

const app = new Elysia()
	.use(betterAuth)
	.get("/", () => "Hello Elysia")
	.get("/me", ({ user }) => user, { auth: true });

export default app;
