import { z } from "zod";

const idSchema = z.union([z.number(), z.string()]);
const nullableIdSchema = idSchema.nullable().optional();
const nullableStringSchema = z.string().nullable().optional();

/**
 * Every Hostkit mutation answers `{ "status": "success", ... }`. The client
 * checks the literal separately so a non-success status surfaces as a
 * {@link HostkitApiError} with the provider text instead of a schema failure.
 */
export const hostkitStatusSchema = z.looseObject({
	status: z.string(),
});

export const hostkitPropertySchema = z.looseObject({
	default_series: nullableStringSchema,
	invoicing_nif: nullableStringSchema,
});

export const hostkitOnlineCheckinSchema = z.looseObject({
	shortlink: nullableStringSchema,
	// "done" when the online check-in is complete, empty otherwise.
	status: nullableStringSchema,
});

/** Hostkit reuses the legacy SEF key name for the SIBA submission timestamp. */
export const hostkitLastSibaDateSchema = z.looseObject({
	sefdate: nullableStringSchema,
});

export const hostkitAddInvoiceResultSchema = hostkitStatusSchema.extend({
	id: nullableIdSchema,
});

export const hostkitAddInvoiceLineResultSchema = hostkitStatusSchema.extend({
	line: nullableIdSchema,
});

export const hostkitCloseInvoiceResultSchema = hostkitStatusSchema.extend({
	invoice_token: nullableStringSchema,
	invoice_url: nullableStringSchema,
});

export const hostkitAddCreditNoteResultSchema = hostkitStatusSchema.extend({
	id: nullableIdSchema,
});

export const hostkitInvoiceRecordSchema = z.looseObject({
	closed: nullableStringSchema,
	comment: nullableStringSchema,
	date: nullableStringSchema,
	has_receipt: nullableStringSchema,
	id: nullableIdSchema,
	invoice_token: nullableStringSchema,
	invoice_type: nullableStringSchema,
	invoice_url: nullableStringSchema,
	name: nullableStringSchema,
	nif: nullableStringSchema,
	rcode: nullableStringSchema,
	series: nullableStringSchema,
	value: nullableStringSchema,
});

export const hostkitInvoiceListSchema = z.array(hostkitInvoiceRecordSchema);

export const hostkitCreditNoteRecordSchema = z.looseObject({
	credit_note_url: nullableStringSchema,
	id: nullableIdSchema,
	refid: nullableIdSchema,
	series: nullableStringSchema,
});

export const hostkitCreditNoteListSchema = z.array(
	hostkitCreditNoteRecordSchema,
);

export type HostkitStatusResponse = z.output<typeof hostkitStatusSchema>;
export type HostkitProperty = z.output<typeof hostkitPropertySchema>;
export type HostkitOnlineCheckin = z.output<typeof hostkitOnlineCheckinSchema>;
export type HostkitLastSibaDate = z.output<typeof hostkitLastSibaDateSchema>;
export type HostkitAddInvoiceResult = z.output<
	typeof hostkitAddInvoiceResultSchema
>;
export type HostkitAddInvoiceLineResult = z.output<
	typeof hostkitAddInvoiceLineResultSchema
>;
export type HostkitCloseInvoiceResult = z.output<
	typeof hostkitCloseInvoiceResultSchema
>;
export type HostkitAddCreditNoteResult = z.output<
	typeof hostkitAddCreditNoteResultSchema
>;
export type HostkitInvoiceRecord = z.output<typeof hostkitInvoiceRecordSchema>;
export type HostkitCreditNoteRecord = z.output<
	typeof hostkitCreditNoteRecordSchema
>;
