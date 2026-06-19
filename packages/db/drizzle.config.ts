import { defineConfig } from "drizzle-kit";

const DEFAULT_DATABASE_URL =
	"postgres://postgres:postgres@localhost:5432/alojamentoideal";

export default defineConfig({
	schema: "./src/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
	},
	migrations: {
		schema: "public",
		table: "drizzle_migrations",
	},
	schemaFilter: ["public"],
	breakpoints: true,
	strict: true,
});
