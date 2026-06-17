import { Elysia } from "elysia";
import { betterAuth } from "./auth.js";

const app = new Elysia()
	.use(betterAuth)
	.get("/", () => "Hello Elysia")
	.get("/me", ({ user }) => user, { auth: true });

app.listen(3000);

export default app;
