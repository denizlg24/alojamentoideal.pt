import { getAuth } from "@workspace/auth";

export async function GET(request: Request): Promise<Response> {
	const session = await getAuth().api.getSession({ headers: request.headers });

	if (!session) {
		return new Response(null, { status: 401 });
	}

	return Response.json(session.user);
}
