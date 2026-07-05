"use client";

import type {
	EditableInvoiceLine,
	InvoiceCustomerDraft,
	OrderItemInvoiceDraft,
} from "@workspace/core/invoicing";
import { Button } from "@workspace/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@workspace/ui/components/combobox";
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
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatMoneyMinor } from "@/lib/format";

interface InvoicePanelProps {
	draft: OrderItemInvoiceDraft;
	invoicingEnabled: boolean;
	reference: string;
}

const LINE_TYPES = [
	{ label: "Service", value: "S" },
	{ label: "Product", value: "P" },
	{ label: "Tax", value: "I" },
] as const;

/**
 * Hostkit certified-product presets (mirrors the auto-mapping catalogue).
 * Surfaced as combobox suggestions; the operator can still type any product id
 * (Hostkit creates unknown ids on the fly).
 */
const PRODUCT_PRESETS = [
	{ id: "AL", label: "Accommodation" },
	{ id: "CF", label: "Cleaning" },
	{ id: "TMT", label: "Tourist tax" },
	{ id: "PA", label: "Breakfast" },
	{ id: "SAL", label: "Service fee" },
	{ id: "EXTRAS", label: "Extras" },
] as const;

function blankLine(): EditableInvoiceLine {
	return {
		customDescription: "",
		discount: 0,
		price: "0.00",
		productId: "EXTRAS",
		productLabel: "Extras",
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

function productLabel(productId: string): string {
	return (
		PRODUCT_PRESETS.find((product) => product.id === productId)?.label ??
		productId
	);
}

function filledInvoiceLines(
	lines: EditableInvoiceLine[],
): EditableInvoiceLine[] {
	return lines.filter((line) => {
		const price = Number(line.price);
		return (
			line.productId.trim().length > 0 &&
			line.quantity > 0 &&
			Number.isFinite(price) &&
			price !== 0
		);
	});
}

/**
 * Always-visible, full-width semi-manual invoicing form. Initialized from the
 * server-built draft (no fetch); the operator edits every line and the
 * recipient before issuing to Hostkit. The document total may legitimately
 * diverge from the charged amount.
 */
export function InvoicePanel({
	draft,
	invoicingEnabled,
	reference,
}: InvoicePanelProps) {
	const router = useRouter();
	const [customer, setCustomer] = useState<InvoiceCustomerDraft>(
		draft.customer,
	);
	const [lines, setLines] = useState<EditableInvoiceLine[]>(
		draft.lines.length > 0 ? draft.lines : [blankLine()],
	);
	const [invoiceType, setInvoiceType] = useState<"FR" | "FT">(
		draft.invoiceType,
	);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const currency = draft.currency;

	function updateLine(index: number, patch: Partial<EditableInvoiceLine>) {
		setLines((current) =>
			current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
		);
	}

	function submit() {
		const filled = filledInvoiceLines(lines).map((line) => ({
			...line,
			customDescription: line.customDescription?.trim() || null,
			productLabel: line.productLabel?.trim() || productLabel(line.productId),
		}));
		if (filled.length === 0) {
			setError("Add at least one line with a product, quantity and price.");
			return;
		}

		startTransition(async () => {
			setError(null);
			const response = await fetch(
				`/api/admin/orders/${encodeURIComponent(reference)}/items/${encodeURIComponent(draft.orderItemId)}/invoice`,
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
			router.refresh();
		});
	}

	const total = linesTotalMinor(lines);
	const canSubmit = invoicingEnabled && draft.hostkitConfigured;

	const [createProduct, setCreateProduct] = useState<{
		enabled: boolean;
		lineIndex: number;
		label: string;
		id: string;
	}>({ enabled: false, lineIndex: -1, label: "", id: "" });

	function openCreateProductDialog(lineIndex: number, label: string) {
		const trimmedLabel = label.trim();
		if (trimmedLabel.length === 0) {
			return;
		}

		setCreateProduct({
			enabled: true,
			lineIndex,
			label: trimmedLabel,
			id: trimmedLabel.toUpperCase().replace(/\s+/g, "_"),
		});
	}

	return (
		<div className="mt-3 space-y-4 rounded-lg border border-border/60 p-4">
			<Dialog
				open={createProduct.enabled}
				onOpenChange={(enabled) => {
					if (!enabled) {
						setCreateProduct({
							enabled: false,
							lineIndex: -1,
							label: "",
							id: "",
						});
						return;
					}
					setCreateProduct((current) => ({ ...current, enabled }));
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create a custom Product</DialogTitle>
						<DialogDescription>
							Create a new custom product for this invoice.
						</DialogDescription>
					</DialogHeader>
					<form className="flex w-full flex-col gap-2">
						<Label htmlFor="product-name">Product Name</Label>
						<Input
							value={createProduct.label}
							onChange={(e) =>
								setCreateProduct((prev) => ({
									...prev,
									label: e.target.value,
								}))
							}
							id="product-name"
							placeholder="Accommodation"
						/>
						<Label htmlFor="product-id">Product ID</Label>
						<Input
							value={createProduct.id}
							onChange={(e) =>
								setCreateProduct((prev) => ({
									...prev,
									id: e.target.value,
								}))
							}
							id="product-id"
							placeholder="AL"
						/>
						<Button
							type="button"
							onClick={() => {
								updateLine(createProduct.lineIndex, {
									productId: createProduct.id,
									productLabel: createProduct.label,
								});
								setCreateProduct({
									enabled: false,
									lineIndex: -1,
									label: "",
									id: "",
								});
							}}
						>
							Create Product
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">Invoice</h3>
				<div className="flex items-center gap-2">
					<Label
						className="text-muted-foreground text-xs"
						htmlFor={`invoice-type-${draft.orderItemId}`}
					>
						Type
					</Label>
					<NativeSelect
						className="h-8 w-24"
						id={`invoice-type-${draft.orderItemId}`}
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

			{!invoicingEnabled ? (
				<p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-500">
					Issuance is disabled. Set HOSTKIT_INVOICING_ENABLED=true to enable it.
					You can still edit the draft.
				</p>
			) : null}
			{!draft.hostkitConfigured ? (
				<p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
					No Hostkit API key is configured for this listing.
				</p>
			) : null}

			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				<div className="space-y-1.5">
					<Label htmlFor={`cust-name-${draft.orderItemId}`}>Name</Label>
					<Input
						id={`cust-name-${draft.orderItemId}`}
						onChange={(event) =>
							setCustomer({ ...customer, name: event.target.value })
						}
						value={customer.name}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`cust-nif-${draft.orderItemId}`}>
						Tax number (NIF)
					</Label>
					<Input
						id={`cust-nif-${draft.orderItemId}`}
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
					<Label htmlFor={`cust-country-${draft.orderItemId}`}>
						Country (ISO)
					</Label>
					<Input
						id={`cust-country-${draft.orderItemId}`}
						maxLength={3}
						onChange={(event) =>
							setCustomer({ ...customer, country: event.target.value })
						}
						placeholder="PT"
						value={customer.country}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`cust-city-${draft.orderItemId}`}>City</Label>
					<Input
						id={`cust-city-${draft.orderItemId}`}
						onChange={(event) =>
							setCustomer({ ...customer, city: event.target.value || null })
						}
						value={customer.city ?? ""}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`cust-address-${draft.orderItemId}`}>Address</Label>
					<Input
						id={`cust-address-${draft.orderItemId}`}
						onChange={(event) =>
							setCustomer({ ...customer, address: event.target.value || null })
						}
						value={customer.address ?? ""}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`cust-postal-${draft.orderItemId}`}>
						Postal code
					</Label>
					<Input
						id={`cust-postal-${draft.orderItemId}`}
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

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<h4 className="text-muted-foreground text-xs uppercase tracking-wide">
						Lines
					</h4>
					<Button
						onClick={() => setLines((current) => [...current, blankLine()])}
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
											placeholder={
												line.productLabel ?? productLabel(line.productId)
											}
											value={line.customDescription ?? ""}
										/>
									</td>
									<td className="py-1 pr-2">
										<Combobox
											items={PRODUCT_PRESETS}
											value={line.productId}
											onValueChange={(value) => {
												if (value) {
													updateLine(index, {
														productId: value,
														productLabel: productLabel(value),
													});
												}
											}}
											onInputValueChange={(value) => {
												setCreateProduct((prev) => ({ ...prev, label: value }));
											}}
										>
											<ComboboxInput
												className="h-8 w-28"
												onKeyDown={(event) => {
													if (event.key !== "Enter") {
														return;
													}

													const label = createProduct.label.trim();
													const hasPreset = PRODUCT_PRESETS.some(
														(product) =>
															product.id.toLowerCase() ===
																label.toLowerCase() ||
															product.label.toLowerCase() ===
																label.toLowerCase(),
													);

													if (!hasPreset) {
														event.preventDefault();
														openCreateProductDialog(index, label);
													}
												}}
												placeholder="Select a product"
											/>
											<ComboboxContent className="w-50! max-w-full!">
												<ComboboxEmpty className="p-2">
													<Button
														className="h-8 w-full"
														onMouseDown={(event) => event.preventDefault()}
														onClick={() =>
															openCreateProductDialog(
																index,
																createProduct.label,
															)
														}
														size="sm"
														type="button"
														variant="ghost"
													>
														Create custom
													</Button>
												</ComboboxEmpty>
												<ComboboxList>
													{(item) => (
														<ComboboxItem key={item.id} value={item.id}>
															{item.label}
														</ComboboxItem>
													)}
												</ComboboxList>
											</ComboboxContent>
										</Combobox>
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
			</div>

			<div className="flex items-center justify-between gap-4">
				<p className="text-sm">
					Total (gross):{" "}
					<span className="font-medium tabular-nums">
						{formatMoneyMinor(total, currency)}
					</span>
				</p>
				<Button disabled={!canSubmit || pending} onClick={submit} type="button">
					{pending ? "Issuing…" : "Issue invoice"}
				</Button>
			</div>
			{error ? <p className="text-destructive text-sm">{error}</p> : null}
		</div>
	);
}
