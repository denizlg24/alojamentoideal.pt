"use client";

import type {
	OrderContactSummary,
	OrderInvoiceRequestSummary,
} from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	CheckCircle2,
	ChevronRight,
	Download,
	ReceiptText,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface FiscalForm {
	address: string;
	city: string;
	companyName: string;
	country: string;
	isCompany: boolean;
	name: string;
	postalCode: string;
	taxNumber: string;
}

function initialForm(contact: OrderContactSummary): FiscalForm {
	return {
		address:
			typeof contact.billingAddress.line1 === "string"
				? contact.billingAddress.line1
				: "",
		city:
			typeof contact.billingAddress.city === "string"
				? contact.billingAddress.city
				: "",
		companyName: contact.companyName ?? "",
		country:
			typeof contact.billingAddress.country === "string"
				? contact.billingAddress.country
				: "PT",
		isCompany: contact.isCompany,
		name: contact.name,
		postalCode:
			typeof contact.billingAddress.postalCode === "string"
				? contact.billingAddress.postalCode
				: "",
		taxNumber: contact.taxNumber ?? "",
	};
}

export function InvoiceRequestRow({
	contact,
	invoiceRequest,
	reference,
}: {
	contact: OrderContactSummary;
	invoiceRequest: OrderInvoiceRequestSummary;
	reference: string;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState(() => initialForm(contact));
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const documents = invoiceRequest.documents;

	function submit() {
		startTransition(async () => {
			setError(null);
			const response = await fetch(
				`/api/orders/${encodeURIComponent(reference)}/invoice-request`,
				{
					body: JSON.stringify({
						billingAddress: {
							city: form.city,
							country: form.country,
							line1: form.address,
							line2: "",
							postalCode: form.postalCode,
							region: "",
						},
						companyName: form.isCompany ? form.companyName || null : null,
						isCompany: form.isCompany,
						name:
							form.isCompany && form.companyName ? form.companyName : form.name,
						taxNumber: form.taxNumber,
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
					issues?: { message: string; path: string }[];
				} | null;
				setError(
					body?.issues?.map((issue) => issue.message).join(" ") ||
						body?.error ||
						"Could not request the invoice.",
				);
				return;
			}
			setOpen(false);
			router.refresh();
		});
	}

	if (documents.length > 0) {
		return (
			<div className="-mx-2 rounded-xl bg-emerald-50/70 px-2 py-2 dark:bg-emerald-950/20">
				{documents.map((document, index) => (
					<a
						className="flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-emerald-100/60 dark:hover:bg-emerald-950/40"
						href={`/api/orders/${encodeURIComponent(reference)}/invoices/${encodeURIComponent(document.id)}/document`}
						key={document.id}
					>
						<span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
							<ReceiptText className="size-4" />
						</span>
						<span className="flex flex-col">
							<span className="font-medium text-sm">
								{document.kind === "credit_note"
									? "Credit note"
									: documents.filter((item) => item.kind === "invoice").length >
											1
										? `Invoice ${index + 1}`
										: "Invoice"}
							</span>
							<span className="text-emerald-700 text-xs dark:text-emerald-300">
								Ready to download
							</span>
						</span>
						<Download className="ml-auto size-4 text-emerald-700 dark:text-emerald-300" />
					</a>
				))}
			</div>
		);
	}

	if (invoiceRequest.requestedAt) {
		return (
			<div className="-mx-2 flex items-center gap-3 rounded-xl bg-amber-50 px-2 py-3 dark:bg-amber-950/20">
				<span className="grid size-9 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
					<CheckCircle2 className="size-4" />
				</span>
				<span className="flex flex-col">
					<span className="font-medium text-sm">Invoice requested</span>
					<span className="text-amber-700 text-xs dark:text-amber-300">
						We are preparing it and will email you when it is ready
					</span>
				</span>
			</div>
		);
	}

	return (
		<>
			<button
				className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-muted/60"
				onClick={() => setOpen(true)}
				type="button"
			>
				<span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
					<ReceiptText className="size-4" />
				</span>
				<span className="flex flex-col">
					<span className="font-medium text-sm">Request invoice</span>
					<span className="text-muted-foreground text-xs">
						Add the fiscal details for your invoice
					</span>
				</span>
				<ChevronRight className="ml-auto size-4 text-muted-foreground" />
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Request an invoice</DialogTitle>
						<DialogDescription>
							Enter the fiscal details exactly as they should appear. Our team
							will review the request before issuing the invoice.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-1.5 sm:col-span-2">
							<Label htmlFor="invoice-name">Fiscal name</Label>
							<Input
								id="invoice-name"
								onChange={(event) =>
									setForm({ ...form, name: event.target.value })
								}
								value={form.name}
							/>
						</div>
						<label className="flex items-center gap-2 text-sm sm:col-span-2">
							<input
								checked={form.isCompany}
								onChange={(event) =>
									setForm({ ...form, isCompany: event.target.checked })
								}
								type="checkbox"
							/>{" "}
							Invoice a company
						</label>
						{form.isCompany ? (
							<div className="space-y-1.5 sm:col-span-2">
								<Label htmlFor="invoice-company">Company name</Label>
								<Input
									id="invoice-company"
									onChange={(event) =>
										setForm({ ...form, companyName: event.target.value })
									}
									value={form.companyName}
								/>
							</div>
						) : null}
						<div className="space-y-1.5">
							<Label htmlFor="invoice-tax">Tax number</Label>
							<Input
								id="invoice-tax"
								onChange={(event) =>
									setForm({ ...form, taxNumber: event.target.value })
								}
								value={form.taxNumber}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="invoice-country">Country code</Label>
							<Input
								id="invoice-country"
								maxLength={3}
								onChange={(event) =>
									setForm({
										...form,
										country: event.target.value.toUpperCase(),
									})
								}
								value={form.country}
							/>
						</div>
						<div className="space-y-1.5 sm:col-span-2">
							<Label htmlFor="invoice-address">Address</Label>
							<Input
								id="invoice-address"
								onChange={(event) =>
									setForm({ ...form, address: event.target.value })
								}
								value={form.address}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="invoice-postal">Postal code</Label>
							<Input
								id="invoice-postal"
								onChange={(event) =>
									setForm({ ...form, postalCode: event.target.value })
								}
								value={form.postalCode}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="invoice-city">City</Label>
							<Input
								id="invoice-city"
								onChange={(event) =>
									setForm({ ...form, city: event.target.value })
								}
								value={form.city}
							/>
						</div>
					</div>
					{error ? (
						<p aria-live="polite" className="text-destructive text-sm">
							{error}
						</p>
					) : null}
					<Button disabled={pending} onClick={submit} type="button">
						{pending ? "Sending request…" : "Request invoice"}
					</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
