"use client";

import type { OrderInvoice } from "@workspace/db";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
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
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatMoneyMinor } from "@/lib/format";

export function InvoiceActions({
	invoice,
	reference,
}: {
	invoice: OrderInvoice;
	reference: string;
}) {
	const router = useRouter();
	const [partialOpen, setPartialOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const endpoint = `/api/admin/orders/${encodeURIComponent(reference)}/invoices/${encodeURIComponent(invoice.id)}`;

	function run(url: string, init: RequestInit, success: string) {
		startTransition(async () => {
			setError(null);
			const response = await fetch(url, init);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(body?.error || "The fiscal document action failed.");
				return;
			}
			setPartialOpen(false);
			toast.success(success);
			router.refresh();
		});
	}

	if (invoice.status === "draft" || invoice.status === "failed") {
		return (
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button disabled={pending} size="sm" variant="ghost">
						Delete
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this invoice record?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the {invoice.status} record from the ledger. No
							fiscal document was issued for it, so nothing changes in Hostkit.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								run(endpoint, { method: "DELETE" }, "Invoice record deleted.")
							}
						>
							Delete record
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}
	if (invoice.kind !== "invoice" || invoice.status !== "issued") return null;

	return (
		<div className="flex justify-end gap-1">
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button disabled={pending} size="sm" variant="ghost">
						Credit
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Issue a full credit note?</AlertDialogTitle>
						<AlertDialogDescription>
							Hostkit will issue a credit note for the full amount of this
							invoice. Issued documents cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								run(
									`${endpoint}/credit-note`,
									{
										body: "{}",
										headers: { "content-type": "application/json" },
										method: "POST",
									},
									"Credit note issued.",
								)
							}
						>
							Issue credit note
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Button
				disabled={pending || !invoice.lineSnapshot}
				onClick={() => setPartialOpen(true)}
				size="sm"
				variant="ghost"
			>
				Partial credit
			</Button>
			<Dialog open={partialOpen} onOpenChange={setPartialOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Issue a partial credit</DialogTitle>
						<DialogDescription>
							Hostkit will annul the original invoice and issue a corrected
							replacement for the retained amount. Both documents stay linked in
							the ledger.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1.5">
						<Label htmlFor={`partial-credit-${invoice.id}`}>
							Amount to credit ({invoice.currency})
						</Label>
						<Input
							id={`partial-credit-${invoice.id}`}
							inputMode="decimal"
							onChange={(event) => setAmount(event.target.value)}
							placeholder="50.00"
							value={amount}
						/>
					</div>
					<p className="text-muted-foreground text-xs">
						Original total:{" "}
						{formatMoneyMinor(invoice.totalMinor, invoice.currency)}
					</p>
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
					<Button
						disabled={
							pending || !Number.isFinite(Number(amount)) || Number(amount) <= 0
						}
						onClick={() =>
							run(
								`${endpoint}/credit-note`,
								{
									body: JSON.stringify({
										creditAmountMinor: Math.round(Number(amount) * 100),
									}),
									headers: { "content-type": "application/json" },
									method: "POST",
								},
								"Partial credit and replacement invoice issued.",
							)
						}
					>
						{pending ? "Issuing…" : "Issue partial credit"}
					</Button>
				</DialogContent>
			</Dialog>
		</div>
	);
}
