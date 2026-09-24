"use client";

import type { DiscountScope } from "@workspace/db";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

interface DiscountCodeFormProps {
	appliedCode: string | null;
	appliedScope: DiscountScope | null;
	error: string | null;
	onApply: (code: string) => void;
	onRemove: () => void;
	pending: boolean;
}

/** Applies/removes a Stripe promotion code via the cart discount route. */
const SCOPE_SUFFIX: Record<DiscountScope, string> = {
	activities: " to activities",
	all: "",
	housing: " to homes",
};

export function DiscountCodeForm({
	appliedCode,
	appliedScope,
	error,
	onApply,
	onRemove,
	pending,
}: DiscountCodeFormProps) {
	const [code, setCode] = useState("");

	if (appliedCode) {
		return (
			<div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950">
				<span className="text-emerald-800 dark:text-emerald-200">
					Promo code <span className="font-medium">{appliedCode}</span> applied
					{appliedScope ? SCOPE_SUFFIX[appliedScope] : ""}
				</span>
				<Button disabled={pending} onClick={onRemove} size="sm" variant="ghost">
					Remove
				</Button>
			</div>
		);
	}

	const submit = () => {
		if (pending) {
			return;
		}
		const trimmed = code.trim();
		if (trimmed) {
			onApply(trimmed);
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex gap-2">
				<Input
					aria-label="Promo code"
					autoCapitalize="characters"
					onChange={(event) => setCode(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}}
					placeholder="Promo code"
					value={code}
				/>
				<Button
					disabled={pending || code.trim().length === 0}
					onClick={submit}
					variant="outline"
				>
					{pending ? "Applying" : "Apply"}
				</Button>
			</div>
			{error && <p className="text-destructive text-xs">{error}</p>}
		</div>
	);
}
