import { withAdminRoute } from "@/lib/api/admin-route";
import { getDetoursSettlementReport } from "@/lib/reporting/detours-settlements";
import {
	detoursSettlementReportToCsv,
	detoursSettlementReportToPdf,
	parseDetoursSettlementPeriod,
} from "@/lib/reporting/detours-settlements-core";

export const runtime = "nodejs";

function filename(format: "csv" | "pdf", from: string, to: string): string {
	return `detours-settlement-${from}-to-${to}.${format}`;
}

export const GET = withAdminRoute(
	{
		name: "admin.settlements.detours.export",
		rateLimit: { bucket: "cart.read" },
	},
	async (request: Request): Promise<Response> => {
		const searchParams = new URL(request.url).searchParams;
		const format = searchParams.get("format");
		if (format !== "csv" && format !== "pdf") {
			return Response.json(
				{
					code: "invalid_request",
					error: "Format must be csv or pdf.",
				},
				{ status: 400 },
			);
		}

		const period = parseDetoursSettlementPeriod({
			from: searchParams.get("from"),
			to: searchParams.get("to"),
		});
		const report = await getDetoursSettlementReport(period);

		if (format === "csv") {
			return new Response(detoursSettlementReportToCsv(report), {
				headers: {
					"Cache-Control": "private, no-store",
					"Content-Disposition": `attachment; filename="${filename(
						"csv",
						period.from,
						period.to,
					)}"`,
					"Content-Type": "text/csv; charset=utf-8",
				},
			});
		}

		const pdf = detoursSettlementReportToPdf(report);

		return new Response(pdf, {
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": `attachment; filename="${filename(
					"pdf",
					period.from,
					period.to,
				)}"`,
				"Content-Type": "application/pdf",
			},
		});
	},
);
