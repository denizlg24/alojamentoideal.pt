export function GET(): Response {
	return Response.json({ service: "web", status: "ok" } as const);
}
