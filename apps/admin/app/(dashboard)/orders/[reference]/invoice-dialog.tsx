"use client";

import type {
	EditableInvoiceLine,
	InvoiceCustomerDraft,
	OrderItemInvoiceDraft,
} from "@workspace/core/invoicing";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatMoneyMinor } from "@/lib/format";

interface InvoiceDialogProps {
	currency: string;
	invoicingEnabled: boolean;
	itemId: string;
	itemTitle: string;
	reference: string;
}

const LINE_TYPES = [
	{ label: "Service", value: "S" },
	{ label: "Product", value: "P" },
	{ label: "Tax", value: "I" },
] as const;

function blankLine(): EditableInvoiceLine {
	return {
		customDescription: "",
		discount: 0,
		price: "0.00",
		productId: "EXTRAS",
		quantity: 1,
		reasonCode: null,
		type: "S",
		vat: 6,
	};
}

/** Mirrors editableInvoiceLinesTotalMinor without importing the server bundle. */
function linesTotalMinor(lines: EditableInvoiceLine[]): number {
	let total = 0;
	for (const line of lines) {
		const unitMinor = Math.round(Number(line.price) * 100);
		if (!Number.isFinite(unitMinor)) {
			continue;
		}
		const net = Math.round(
			(unitMinor * line.quantity * (100 - line.discount)) / 100,
		);
		total += Math.round((net * (100 + line.vat)) / 100);
	}
	return total;
}

/**
 * Semi-manual invoicing form. On open it fetches the prefilled draft, then lets
 * the operator edit every line and the recipient before issuing to Hostkit. The
 * document total may legitimately diverge from the charged amount.
 */
export function InvoiceDialog({
	currency,
	invoicingEnabled,
	itemId,
	itemTitle,
	reference,
}: InvoiceDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [customer, setCustomer] = useState<InvoiceCustomerDraft | null>(null);
	const [lines, setLines] = useState<EditableInvoiceLine[]>([]);
	const [invoiceType, setInvoiceType] = useState<"FR" | "FT">("FR");
	const [hostkitConfigured, setHostkitConfigured] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	async function loadDraft() {
		setLoading(true);
		setLoadError(null);
		try {
			const response = await fetch(
				`/api/admin/orders/${encodeURIComponent(reference)}/items/${encodeURIComponent(itemId)}/invoice/draft`,
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				setLoadError(body?.error ?? "Could not load the invoice draft.");
				return;
			}
			const body = (await response.json()) as {
				data: { draft: OrderItemInvoiceDraft };
			};
			const draft = body.data.draft;
			setCustomer(draft.customer);
			setLines(draft.lines.length > 0 ? draft.lines : [blankLine()]);
			setInvoiceType(draft.invoiceType);
			setHostkitConfigured(draft.hostkitConfigured);
		} catch {
			setLoadError("Could not load the invoice draft.");
		} finally {
			setLoading(false);
		}
	}

	function handleOpenChange(next: boolean) {
		setOpen(next);
		if (next && !customer) {
			void loadDraft();
		}
		if (!next) {
			setError(null);
		}
	}

	function updateLine(index: number, patch: Partial<EditableInvoiceLine>) {
		setLines((current) =>
			current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
		);
	}

	function submit() {
		if (!customer) {
			return;
		}
		const filled = lines.filter(
			(line) => line.customDescription.trim().length > 0,
		);
		if (filled.length === 0) {
			setError("Add at least one line with a description.");
			return;
		}

		startTransition(async () => {
			setError(null);
			const response = await fetch(
				`/api/admin/orders/${encodeURIComponent(reference)}/items/${encodeURIComponent(itemId)}/invoice`,
				{
					body: JSON.stringify({ customer, invoiceType, lines: filled }),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
					issues?: { message: string }[];
				} | null;
				const issues = body?.issues?.map((issue) => issue.message).join(" ");
				setError(issues || body?.error || "Could not issue the invoice.");
				return;
			}
			toast.success("Invoice issued.");
			setOpen(false);
			router.refresh();
		});
	}

	const total = linesTotalMinor(lines);
	const canSubmit = invoicingEnabled && hostkitConfigured && !loading;

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					Issue invoice
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Issue invoice · {itemTitle}</DialogTitle>
					<DialogDescription>
						Review and edit the draft before issuing to Hostkit. Lines and the
						recipient are fully editable; the total may differ from the charged
						amount.
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<p className="py-6 text-muted-foreground text-sm">Loading draft…</p>
				) : loadError ? (
					<p className="py-6 text-destructive text-sm">{loadError}</p>
				) : customer ? (
					<div className="space-y-6">
						{!invoicingEnabled ? (
							<p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-500">
								Issuance is disabled. Set HOSTKIT_INVOICING_ENABLED=true to
								enable it. You can still review the draft.
							</p>
						) : null}
						{!hostkitConfigured ? (
							<p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
								No Hostkit API key is configured for this listing.
							</p>
						) : null}

						<section className="space-y-3">
							<div className="flex items-center justify-between">
								<h3 className="font-medium text-sm">Recipient</h3>
								<div className="flex items-center gap-2">
									<Label className="text-xs" htmlFor="invoice-type">
										Type
									</Label>
									<NativeSelect
										className="h-8 w-24"
										id="invoice-type"
										onChange={(event) =>
											setInvoiceType(event.target.value as "FR" | "FT")
										}
										value={invoiceType}
									>
										<NativeSelectOption value="FR">FR</NativeSelectOption>
										<NativeSelectOption value="FT">FT</NativeSelectOption>
									</NativeSelect>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1.5">
									<Label htmlFor="cust-name">Name</Label>
									<Input
										id="cust-name"
										onChange={(event) =>
											setCustomer({ ...customer, name: event.target.value })
										}
										value={customer.name}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cust-nif">Tax number (NIF)</Label>
									<Input
										id="cust-nif"
										onChange={(event) =>
											setCustomer({
												...customer,
												taxNumber: event.target.value || null,
											})
										}
										placeholder="Final consumer"
										value={customer.taxNumber ?? ""}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cust-country">Country (ISO)</Label>
									<Input
										id="cust-country"
										maxLength={3}
										onChange={(event) =>
											setCustomer({ ...customer, country: event.target.value })
										}
										placeholder="PT"
										value={customer.country}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cust-city">City</Label>
									<Input
										id="cust-city"
										onChange={(event) =>
											setCustomer({
												...customer,
												city: event.target.value || null,
											})
										}
										value={customer.city ?? ""}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cust-address">Address</Label>
									<Input
										id="cust-address"
										onChange={(event) =>
											setCustomer({
												...customer,
												address: event.target.value || null,
											})
										}
										value={customer.address ?? ""}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cust-postal">Postal code</Label>
									<Input
										id="cust-postal"
										onChange={(event) =>
											setCustomer({
												...customer,
												postalCode: event.target.value || null,
											})
										}
										value={customer.postalCode ?? ""}
									/>
								</div>
							</div>
						</section>

						<section className="space-y-3">
							<div className="flex items-center justify-between">
								<h3 className="font-medium text-sm">Lines</h3>
								<Button
									onClick={() =>
										setLines((current) => [...current, blankLine()])
									}
									size="sm"
									type="button"
									variant="ghost"
								>
									<Plus className="size-3.5" /> Add row
								</Button>
							</div>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[640px] text-sm">
									<thead>
										<tr className="text-left text-muted-foreground text-xs">
											<th className="pb-1 font-normal">Description</th>
											<th className="pb-1 font-normal">Product</th>
											<th className="pb-1 font-normal">Type</th>
											<th className="pb-1 text-right font-normal">Qty</th>
											<th className="pb-1 text-right font-normal">Unit</th>
											<th className="pb-1 text-right font-normal">VAT%</th>
											<th className="pb-1 text-right font-normal">Disc%</th>
											<th className="pb-1" />
										</tr>
									</thead>
									<tbody>
										{lines.map((line, index) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder only on add/remove
											<tr key={index}>
												<td className="py-1 pr-2">
													<Input
														className="h-8"
														onChange={(event) =>
															updateLine(index, {
																customDescription: event.target.value,
															})
														}
														value={line.customDescription}
													/>
												</td>
												<td className="py-1 pr-2">
													<Input
														className="h-8 w-20"
														onChange={(event) =>
															updateLine(index, {
																productId: event.target.value,
															})
														}
														value={line.productId}
													/>
												</td>
												<td className="py-1 pr-2">
													<NativeSelect
														className="h-8 w-24"
														onChange={(event) =>
															updateLine(index, {
																type: event.target.value as "I" | "P" | "S",
															})
														}
														value={line.type}
													>
														{LINE_TYPES.map((option) => (
															<NativeSelectOption
																key={option.value}
																value={option.value}
															>
																{option.label}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</td>
												<td className="py-1 pr-2">
													<Input
														className="h-8 w-16 text-right"
														inputMode="numeric"
														onChange={(event) =>
															updateLine(index, {
																quantity: Number(event.target.value) || 0,
															})
														}
														value={line.quantity}
													/>
												</td>
												<td className="py-1 pr-2">
													<Input
														className="h-8 w-24 text-right"
														inputMode="decimal"
														onChange={(event) =>
															updateLine(index, { price: event.target.value })
														}
														value={line.price}
													/>
												</td>
												<td className="py-1 pr-2">
													<Input
														className="h-8 w-16 text-right"
														inputMode="numeric"
														onChange={(event) =>
															updateLine(index, {
																vat: Number(event.target.value) || 0,
															})
														}
														value={line.vat}
													/>
												</td>
												<td className="py-1 pr-2">
													<Input
														className="h-8 w-16 text-right"
														inputMode="numeric"
														onChange={(event) =>
															updateLine(index, {
																discount: Number(event.target.value) || 0,
															})
														}
														value={line.discount}
													/>
												</td>
												<td className="py-1">
													<Button
														aria-label="Remove line"
														disabled={lines.length === 1}
														onClick={() =>
															setLines((current) =>
																current.filter((_, i) => i !== index),
															)
														}
														size="icon"
														type="button"
														variant="ghost"
													>
														<Trash2 className="size-3.5" />
													</Button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<p className="text-right text-sm">
								Total (gross):{" "}
								<span className="font-medium tabular-nums">
									{formatMoneyMinor(total, currency)}
								</span>
							</p>
						</section>

						{error ? <p className="text-destructive text-sm">{error}</p> : null}
					</div>
				) : null}

				<DialogFooter>
					<Button onClick={() => setOpen(false)} type="button" variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={!canSubmit || pending}
						onClick={submit}
						type="button"
					>
						{pending ? "Issuing…" : "Issue invoice"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
