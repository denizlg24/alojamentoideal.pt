"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { Check } from "lucide-react";

interface CurrencyDialogProps {
	currency: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

// Display-only for now: prices and payment settle in the listing currency.
// Multi-currency needs server-side pricing + payment conversion before any of
// these become selectable.
const CURRENCIES = [
	{ code: "EUR", label: "Euro" },
	{ code: "USD", label: "US Dollar" },
	{ code: "GBP", label: "British Pound" },
];

export function CurrencyDialog({
	currency,
	onOpenChange,
	open,
}: CurrencyDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="rounded-2xl">
				<DialogHeader>
					<DialogTitle>Currency</DialogTitle>
					<DialogDescription>
						Your stay is priced and paid in {currency}. More display currencies
						are coming soon.
					</DialogDescription>
				</DialogHeader>
				<ul className="flex flex-col gap-1">
					{CURRENCIES.map((entry) => {
						const selected = entry.code === currency;
						return (
							<li key={entry.code}>
								<div
									className={cn(
										"flex items-center justify-between rounded-xl px-3 py-2.5 text-sm",
										selected ? "bg-muted" : "text-muted-foreground",
									)}
								>
									<span>
										{entry.label} ({entry.code})
									</span>
									{selected && <Check className="size-4" />}
								</div>
							</li>
						);
					})}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
