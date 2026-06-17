import { getAuth } from "@workspace/auth";

export function GET(request: Request): Promise<Response> {
	return getAuth().handler(request);
}

export function POST(request: Request): Promise<Response> {
	return getAuth().handler(request);
}
