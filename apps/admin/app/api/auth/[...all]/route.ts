import { getAdminAuth } from "@/lib/auth/server";

export function GET(request: Request): Promise<Response> {
	return getAdminAuth().handler(request);
}

export function POST(request: Request): Promise<Response> {
	return getAdminAuth().handler(request);
}
