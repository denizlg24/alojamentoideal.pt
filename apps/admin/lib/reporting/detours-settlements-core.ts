import type { PaymentIntentSettlementSnapshot } from "@workspace/core/integrations/stripe";

export type DetoursSettlementFeeStatus =
	| "available"
	| "currency_mismatch"
	| "missing_payment_intent"
	| "missing_stripe_fee"
	| "stripe_error"
	| "stripe_unavailable";

export interface DetoursSettlementPeriod {
	from: string;
	fromDate: Date;
	to: string;
	toExclusiveDate: Date;
}

export interface DetoursSettlementSourceRow {
	activityDate: string;
	activityTitle: string;
	currency: string;
	itemId: string;
	orderId: string;
	orderReference: string;
	orderStatus: string;
	orderTotalMinor: number;
	providerBookingStatus: string | null;
	settlementRecordedAt: Date;
	stripePaymentIntentId: string | null;
	transferredGrossMinor: number;
}

export interface DetoursSettlementReportRow {
	activityDate: string;
	activityTitle: string;
	chargeId: string | null;
	currency: string;
	feeStatus: DetoursSettlementFeeStatus;
	itemId: string;
	netMinor: number | null;
	orderReference: string;
	orderStatus: string;
	paymentIntentId: string | null;
	providerBookingStatus: string | null;
	settlementRecordedAt: Date;
	stripeFeeMinor: number | null;
	transferredGrossMinor: number;
}

export interface DetoursSettlementTotal {
	currency: string;
	itemCount: number;
	missingFeeItemCount: number;
	netMinor: number | null;
	orderCount: number;
	settlementDueMinor: number;
	stripeFeeMinor: number;
	transferredGrossMinor: number;
}

export interface DetoursSettlementReport {
	feeDataComplete: boolean;
	itemCount: number;
	orderCount: number;
	period: DetoursSettlementPeriod;
	rows: DetoursSettlementReportRow[];
	totals: DetoursSettlementTotal[];
}

interface BuildReportOptions {
	failedPaymentIntentIds?: ReadonlySet<string>;
	period: DetoursSettlementPeriod;
	settlementsByPaymentIntent: ReadonlyMap<
		string,
		PaymentIntentSettlementSnapshot | null
	>;
	stripeAvailable: boolean;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_X = 40;
const PDF_START_Y = 802;
const PDF_LINE_HEIGHT = 13;
const PDF_MAX_LINES = 58;
const PDF_MAX_LINE_CHARS = 108;

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatIsoDate(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)}`;
}

function dateFromIsoDate(value: string): Date | null {
	if (!ISO_DATE_PATTERN.test(value)) {
		return null;
	}
	const [yearText, monthText, dayText] = value.split("-");
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date;
}

function addUtcDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function defaultPeriod(
	now: Date,
): Pick<DetoursSettlementPeriod, "from" | "to"> {
	return {
		from: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`,
		to: formatIsoDate(now),
	};
}

export function parseDetoursSettlementPeriod(
	input: { from?: string | null; to?: string | null },
	now = new Date(),
): DetoursSettlementPeriod {
	const defaults = defaultPeriod(now);
	const from = dateFromIsoDate(input.from ?? "")
		? (input.from ?? "")
		: defaults.from;
	const to = dateFromIsoDate(input.to ?? "") ? (input.to ?? "") : defaults.to;
	const fromDate = dateFromIsoDate(from);
	const toDate = dateFromIsoDate(to);

	if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
		const fallbackFromDate = dateFromIsoDate(defaults.from);
		const fallbackToDate = dateFromIsoDate(defaults.to);
		if (!fallbackFromDate || !fallbackToDate) {
			throw new Error("Default settlement period is invalid");
		}
		return {
			from: defaults.from,
			fromDate: fallbackFromDate,
			to: defaults.to,
			toExclusiveDate: addUtcDays(fallbackToDate, 1),
		};
	}

	return {
		from,
		fromDate,
		to,
		toExclusiveDate: addUtcDays(toDate, 1),
	};
}

export function allocateMinorByWeight(
	totalMinor: number,
	weights: readonly number[],
): number[] {
	const totalWeight = weights.reduce(
		(sum, weight) => sum + Math.max(0, weight),
		0,
	);
	if (totalMinor <= 0 || totalWeight <= 0 || weights.length === 0) {
		return weights.map(() => 0);
	}

	const allocations = weights.map(() => 0);
	let allocated = 0;
	for (let index = 0; index < weights.length - 1; index += 1) {
		const weight = Math.max(0, weights[index] ?? 0);
		const share = Math.floor((totalMinor * weight) / totalWeight);
		allocations[index] = share;
		allocated += share;
	}
	allocations[weights.length - 1] = totalMinor - allocated;
	return allocations;
}

function activityFeeTotalMinor(input: {
	activityGrossMinor: number;
	orderStripeFeeMinor: number;
	orderTotalMinor: number;
}): number {
	if (input.orderTotalMinor <= 0) {
		return input.orderStripeFeeMinor;
	}
	if (input.activityGrossMinor >= input.orderTotalMinor) {
		return input.orderStripeFeeMinor;
	}
	return Math.round(
		(input.orderStripeFeeMinor * input.activityGrossMinor) /
			input.orderTotalMinor,
	);
}

function groupByOrder(
	rows: readonly DetoursSettlementSourceRow[],
): DetoursSettlementSourceRow[][] {
	const groups = new Map<string, DetoursSettlementSourceRow[]>();
	for (const row of rows) {
		const group = groups.get(row.orderId) ?? [];
		group.push(row);
		groups.set(row.orderId, group);
	}
	return [...groups.values()];
}

function feeStatusForOrder(
	group: readonly DetoursSettlementSourceRow[],
	options: BuildReportOptions,
): {
	allocations: number[];
	chargeId: string | null;
	feeStatus: DetoursSettlementFeeStatus;
} {
	const first = group[0];
	if (!first) {
		return { allocations: [], chargeId: null, feeStatus: "missing_stripe_fee" };
	}
	const paymentIntentId = first.stripePaymentIntentId;
	if (!paymentIntentId) {
		return {
			allocations: group.map(() => 0),
			chargeId: null,
			feeStatus: "missing_payment_intent",
		};
	}
	if (!options.stripeAvailable) {
		return {
			allocations: group.map(() => 0),
			chargeId: null,
			feeStatus: "stripe_unavailable",
		};
	}
	if (options.failedPaymentIntentIds?.has(paymentIntentId)) {
		return {
			allocations: group.map(() => 0),
			chargeId: null,
			feeStatus: "stripe_error",
		};
	}

	const settlement = options.settlementsByPaymentIntent.get(paymentIntentId);
	if (
		!settlement ||
		settlement.stripeFeeMinor === null ||
		!settlement.stripeFeeCurrency
	) {
		return {
			allocations: group.map(() => 0),
			chargeId: settlement?.chargeId ?? null,
			feeStatus: "missing_stripe_fee",
		};
	}

	const currency = first.currency.toUpperCase();
	if (settlement.stripeFeeCurrency.toUpperCase() !== currency) {
		return {
			allocations: group.map(() => 0),
			chargeId: settlement.chargeId,
			feeStatus: "currency_mismatch",
		};
	}

	const activityGrossMinor = group.reduce(
		(sum, row) => sum + row.transferredGrossMinor,
		0,
	);
	const feeTotalMinor = activityFeeTotalMinor({
		activityGrossMinor,
		orderStripeFeeMinor: settlement.stripeFeeMinor,
		orderTotalMinor:
			settlement.amountMinor > 0
				? settlement.amountMinor
				: first.orderTotalMinor,
	});

	return {
		allocations: allocateMinorByWeight(
			feeTotalMinor,
			group.map((row) => row.transferredGrossMinor),
		),
		chargeId: settlement.chargeId,
		feeStatus: "available",
	};
}

function buildTotals(
	rows: readonly DetoursSettlementReportRow[],
): DetoursSettlementTotal[] {
	const totals = new Map<
		string,
		{
			itemCount: number;
			missingFeeItemCount: number;
			orderReferences: Set<string>;
			stripeFeeMinor: number;
			transferredGrossMinor: number;
		}
	>();

	for (const row of rows) {
		const currency = row.currency.toUpperCase();
		const total = totals.get(currency) ?? {
			itemCount: 0,
			missingFeeItemCount: 0,
			orderReferences: new Set<string>(),
			stripeFeeMinor: 0,
			transferredGrossMinor: 0,
		};
		total.itemCount += 1;
		total.orderReferences.add(row.orderReference);
		total.transferredGrossMinor += row.transferredGrossMinor;
		if (row.stripeFeeMinor === null) {
			total.missingFeeItemCount += 1;
		} else {
			total.stripeFeeMinor += row.stripeFeeMinor;
		}
		totals.set(currency, total);
	}

	return [...totals.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([currency, total]) => ({
			currency,
			itemCount: total.itemCount,
			missingFeeItemCount: total.missingFeeItemCount,
			netMinor:
				total.missingFeeItemCount === 0
					? total.transferredGrossMinor - total.stripeFeeMinor
					: null,
			orderCount: total.orderReferences.size,
			settlementDueMinor: total.stripeFeeMinor,
			stripeFeeMinor: total.stripeFeeMinor,
			transferredGrossMinor: total.transferredGrossMinor,
		}));
}

export function buildDetoursSettlementReport(
	sourceRows: readonly DetoursSettlementSourceRow[],
	options: BuildReportOptions,
): DetoursSettlementReport {
	const rows: DetoursSettlementReportRow[] = [];

	for (const group of groupByOrder(sourceRows)) {
		const { allocations, chargeId, feeStatus } = feeStatusForOrder(
			group,
			options,
		);
		for (const [index, row] of group.entries()) {
			const stripeFeeMinor =
				feeStatus === "available" ? (allocations[index] ?? 0) : null;
			rows.push({
				activityDate: row.activityDate,
				activityTitle: row.activityTitle,
				chargeId,
				currency: row.currency.toUpperCase(),
				feeStatus,
				itemId: row.itemId,
				netMinor:
					stripeFeeMinor === null
						? null
						: row.transferredGrossMinor - stripeFeeMinor,
				orderReference: row.orderReference,
				orderStatus: row.orderStatus,
				paymentIntentId: row.stripePaymentIntentId,
				providerBookingStatus: row.providerBookingStatus,
				settlementRecordedAt: row.settlementRecordedAt,
				stripeFeeMinor,
				transferredGrossMinor: row.transferredGrossMinor,
			});
		}
	}

	const orderCount = new Set(rows.map((row) => row.orderReference)).size;
	const totals = buildTotals(rows);

	return {
		feeDataComplete: totals.every((total) => total.missingFeeItemCount === 0),
		itemCount: rows.length,
		orderCount,
		period: options.period,
		rows,
		totals,
	};
}

function currencyFractionDigits(currency: string): number {
	try {
		return (
			new Intl.NumberFormat("en-US", {
				currency,
				style: "currency",
			}).resolvedOptions().maximumFractionDigits ?? 2
		);
	} catch {
		return 2;
	}
}

export function minorToDecimalString(minor: number, currency: string): string {
	const digits = currencyFractionDigits(currency);
	const factor = 10 ** digits;
	const absolute = Math.abs(minor);
	const units = Math.floor(absolute / factor);
	const fraction = absolute % factor;
	const sign = minor < 0 ? "-" : "";
	if (digits === 0) {
		return `${sign}${units}`;
	}
	return `${sign}${units}.${String(fraction).padStart(digits, "0")}`;
}

function csvCell(value: string | number | null): string {
	if (value === null) {
		return "";
	}
	const text = String(value);
	if (!/[",\r\n]/.test(text)) {
		return text;
	}
	return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: readonly (string | number | null)[]): string {
	return values.map(csvCell).join(",");
}

export function detoursSettlementReportToCsv(
	report: DetoursSettlementReport,
): string {
	const lines = [
		csvRow(["Report", "Detours activity settlement"]),
		csvRow(["Period from", report.period.from]),
		csvRow(["Period to", report.period.to]),
		csvRow(["Order count", report.orderCount]),
		csvRow(["Item count", report.itemCount]),
		"",
		csvRow([
			"Currency",
			"Activity gross transferred",
			"Stripe fees paid by Alojamento Ideal",
			"Net after fee settlement",
			"Settlement due from Detours",
			"Orders",
			"Items",
			"Rows missing Stripe fees",
		]),
		...report.totals.map((total) =>
			csvRow([
				total.currency,
				minorToDecimalString(total.transferredGrossMinor, total.currency),
				minorToDecimalString(total.stripeFeeMinor, total.currency),
				total.netMinor === null
					? null
					: minorToDecimalString(total.netMinor, total.currency),
				minorToDecimalString(total.settlementDueMinor, total.currency),
				total.orderCount,
				total.itemCount,
				total.missingFeeItemCount,
			]),
		),
		"",
		csvRow([
			"Order reference",
			"Settlement recorded at",
			"Order status",
			"Activity title",
			"Activity date",
			"Activity status",
			"Payment intent",
			"Charge",
			"Transferred gross",
			"Stripe fee",
			"Net after fee settlement",
			"Currency",
			"Fee status",
		]),
		...report.rows.map((row) =>
			csvRow([
				row.orderReference,
				row.settlementRecordedAt.toISOString(),
				row.orderStatus,
				row.activityTitle,
				row.activityDate,
				row.providerBookingStatus ?? null,
				row.paymentIntentId,
				row.chargeId,
				minorToDecimalString(row.transferredGrossMinor, row.currency),
				row.stripeFeeMinor === null
					? null
					: minorToDecimalString(row.stripeFeeMinor, row.currency),
				row.netMinor === null
					? null
					: minorToDecimalString(row.netMinor, row.currency),
				row.currency,
				row.feeStatus,
			]),
		),
	];
	return `${lines.join("\r\n")}\r\n`;
}

// The hand-rolled PDF uses the built-in Helvetica font, which only covers
// ASCII here. NFKD splits accented letters into base + combining mark, so
// stripping non-ASCII transliterates ("São" -> "Sao") rather than deleting
// whole characters. CSV exports keep the original UTF-8 text.
function pdfSafeText(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[^\x20-\x7E]/g, "")
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)");
}

function wrapPdfLine(line: string): string[] {
	if (line.length <= PDF_MAX_LINE_CHARS) {
		return [line];
	}
	const words = line.split(" ");
	const wrapped: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > PDF_MAX_LINE_CHARS && current) {
			wrapped.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) {
		wrapped.push(current);
	}
	return wrapped;
}

function pdfLinesForReport(report: DetoursSettlementReport): string[] {
	const lines = [
		"Alojamento Ideal",
		"Detours activity settlement report",
		`Period: ${report.period.from} to ${report.period.to}`,
		`Orders: ${report.orderCount}  Activity items: ${report.itemCount}`,
		"",
	];

	for (const total of report.totals) {
		lines.push(
			`${total.currency} gross transferred: ${minorToDecimalString(
				total.transferredGrossMinor,
				total.currency,
			)}`,
			`${total.currency} Stripe fees paid by Alojamento Ideal: ${minorToDecimalString(
				total.stripeFeeMinor,
				total.currency,
			)}`,
			`${total.currency} net after fee settlement: ${
				total.netMinor === null
					? "Not available"
					: minorToDecimalString(total.netMinor, total.currency)
			}`,
			`${total.currency} settlement due from Detours: ${minorToDecimalString(
				total.settlementDueMinor,
				total.currency,
			)}`,
		);
		if (total.missingFeeItemCount > 0) {
			lines.push(
				`${total.missingFeeItemCount} row(s) are missing Stripe fee data.`,
			);
		}
		lines.push("");
	}

	lines.push("Rows");
	for (const row of report.rows) {
		lines.push(
			`${row.orderReference} | ${row.settlementRecordedAt.toISOString()} | ${row.activityDate} | ${row.activityTitle}`,
			`Gross ${minorToDecimalString(row.transferredGrossMinor, row.currency)} ${row.currency} | Fee ${
				row.stripeFeeMinor === null
					? "Not available"
					: minorToDecimalString(row.stripeFeeMinor, row.currency)
			} | Net ${
				row.netMinor === null
					? "Not available"
					: minorToDecimalString(row.netMinor, row.currency)
			} | PI ${row.paymentIntentId ?? "Not available"} | Charge ${
				row.chargeId ?? "Not available"
			}`,
		);
	}
	return lines.flatMap(wrapPdfLine);
}

function paginate(lines: readonly string[]): string[][] {
	const pages: string[][] = [];
	for (let index = 0; index < lines.length; index += PDF_MAX_LINES) {
		pages.push(lines.slice(index, index + PDF_MAX_LINES));
	}
	return pages.length ? pages : [[]];
}

function contentStreamForPage(lines: readonly string[]): string {
	const commands = [
		"BT",
		"/F1 9 Tf",
		`${PDF_MARGIN_X} ${PDF_START_Y} Td`,
		`${PDF_LINE_HEIGHT} TL`,
	];
	for (const line of lines) {
		commands.push(`(${pdfSafeText(line)}) Tj`, "T*");
	}
	commands.push("ET");
	return commands.join("\n");
}

export function detoursSettlementReportToPdf(
	report: DetoursSettlementReport,
): Uint8Array<ArrayBuffer> {
	const pages = paginate(pdfLinesForReport(report));
	const fontObjectId = 3;
	const objects = new Map<number, string>();
	const pageObjectIds = pages.map((_, index) => 4 + index * 2);
	const contentObjectIds = pages.map((_, index) => 5 + index * 2);

	objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
	objects.set(
		2,
		`<< /Type /Pages /Kids [${pageObjectIds
			.map((id) => `${id} 0 R`)
			.join(" ")}] /Count ${pages.length} >>`,
	);
	objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

	for (const [index, lines] of pages.entries()) {
		const stream = contentStreamForPage(lines);
		objects.set(
			pageObjectIds[index] ?? 0,
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${
				contentObjectIds[index]
			} 0 R >>`,
		);
		objects.set(
			contentObjectIds[index] ?? 0,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
	}

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [0];
	const maxObjectId = Math.max(...objects.keys());
	for (let id = 1; id <= maxObjectId; id += 1) {
		const body = objects.get(id);
		if (!body) {
			continue;
		}
		offsets[id] = pdf.length;
		pdf += `${id} 0 obj\n${body}\nendobj\n`;
	}

	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${maxObjectId + 1}\n`;
	pdf += "0000000000 65535 f \n";
	for (let id = 1; id <= maxObjectId; id += 1) {
		pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\n`;
	pdf += `startxref\n${xrefOffset}\n%%EOF`;

	return new TextEncoder().encode(pdf);
}
