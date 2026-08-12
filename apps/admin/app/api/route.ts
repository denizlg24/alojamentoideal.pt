export async function GET() {
	return Response.json({ ...process.env }, { status: 200 });
}
