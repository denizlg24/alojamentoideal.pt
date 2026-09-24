"use client";

import type { DiscountScope } from "@workspace/db";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { TableCell, TableRow } from "@workspace/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy, Info } from "lucide-react";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	setPromotionActiveAction,
	updatePromotionScopeAction,
} from "./actions";
import {
	isDiscountScope,
	type PromotionCodeView,
	type PromotionHealth,
	type PromotionStatus,
	promotionHealth,
	SCOPE_LABELS,
	SCOPE_OPTIONS,
	STATUS_LABELS,
	scopePhrase,
} from "./promotion-display";
import { reachServer, UNREACHABLE_MESSAGE } from "./reach-server";

interface PromotionCodeRowProps {
	code: PromotionCodeView;
	currency: string;
	/** Called when the code is toggled so the row stays in the current filter. */
	onToggle: (promotionCodeId: string) => void;
}

interface ScopeState {
	assigned: boolean;
	value: DiscountScope | null;
}

export function PromotionCodeRow({
	code,
	currency,
	onToggle,
}: PromotionCodeRowProps) {
	const [scopePending, startScopeTransition] = useTransition();
	const [activePending, startActiveTransition] = useTransition();
	const [scope, setOptimisticScope] = useOptimistic<ScopeState>({
		assigned: code.scopeAssigned,
		value: code.scope,
	});
	const [active, setOptimisticActive] = useOptimistic(code.active);
	const health = promotionHealth(
		{ ...code, active, scope: scope.value },
		currency,
	);

	function changeScope(next: string) {
		if (!isDiscountScope(next) || next === scope.value) {
			return;
		}
		startScopeTransition(async () => {
			setOptimisticScope({ assigned: true, value: next });
			const result = await reachServer(() =>
				updatePromotionScopeAction(code.id, next),
			);
			if (!result) {
				toast.error(UNREACHABLE_MESSAGE);
			} else if (result.ok) {
				toast.success(`Code ${code.code} now covers ${scopePhrase(next)}`);
			} else {
				toast.error(result.error);
			}
		});
	}

	function changeActive(next: boolean) {
		onToggle(code.id);
		startActiveTransition(async () => {
			setOptimisticActive(next);
			const result = await reachServer(() =>
				setPromotionActiveAction(code.id, next),
			);
			if (!result) {
				toast.error(UNREACHABLE_MESSAGE);
			} else if (!result.ok) {
				toast.error(result.error);
			} else if (!next) {
				toast.success(`Code ${code.code} deactivated`);
			} else {
				const after = promotionHealth(
					{ ...code, active: true, scope: scope.value },
					currency,
				);
				toast.success(`Code ${code.code} activated`, {
					description:
						after.status === "active"
							? undefined
							: "Checkout still refuses it. Its status explains why.",
				});
			}
		});
	}

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-1">
					<span className="font-medium font-mono">{code.code}</span>
					<CopyCodeButton code={code.code} />
				</div>
				<p className="text-muted-foreground text-xs">
					Created {code.labels.created}
				</p>
			</TableCell>
			<TableCell
				className={cn(
					"tabular-nums",
					!code.discount && "text-muted-foreground",
				)}
			>
				{code.labels.discount}
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-2">
					<Select
						disabled={scopePending}
						onValueChange={changeScope}
						value={scope.value ?? ""}
					>
						<SelectTrigger
							aria-invalid={scope.value === null ? true : undefined}
							aria-label={`What ${code.code} applies to`}
							className="w-32"
							size="sm"
						>
							{/* Explicit label so the server render is not blank before hydration. */}
							<SelectValue placeholder="Pick one">
								{scope.value ? SCOPE_LABELS[scope.value] : undefined}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{SCOPE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{scope.assigned || scope.value === null ? null : (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									className="rounded-sm text-muted-foreground text-xs underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
									type="button"
								>
									Default
								</button>
							</TooltipTrigger>
							<TooltipContent>
								No restriction was ever saved, so it covers homes and
								activities.
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			</TableCell>
			<TableCell>
				<PromotionStatusBadge health={health} />
			</TableCell>
			<TableCell
				className={cn(
					"tabular-nums",
					code.paidOrderCount === 0 && "text-muted-foreground",
				)}
			>
				{code.paidOrderCount} {code.paidOrderCount === 1 ? "order" : "orders"}
			</TableCell>
			<TableCell
				className={code.labels.expires ? undefined : "text-muted-foreground"}
			>
				{code.labels.expires ?? "Never"}
			</TableCell>
			<TableCell className="text-right">
				<Switch
					aria-label={`Activate ${code.code}`}
					checked={active}
					className="align-middle"
					disabled={activePending}
					onCheckedChange={changeActive}
				/>
			</TableCell>
		</TableRow>
	);
}

const STATUS_STYLES: Record<PromotionStatus, { badge: string; dot: string }> = {
	active: { badge: "", dot: "bg-emerald-500" },
	blocked: {
		badge:
			"border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
		dot: "bg-amber-500",
	},
	expired: { badge: "text-muted-foreground", dot: "bg-muted-foreground/40" },
	inactive: { badge: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

function PromotionStatusBadge({ health }: { health: PromotionHealth }) {
	const styles = STATUS_STYLES[health.status];
	const hasReasons = health.reasons.length > 0;
	const badge = (
		<Badge
			className={cn("gap-1.5 align-middle", styles.badge)}
			variant="outline"
		>
			<span aria-hidden className={cn("size-1.5 rounded-full", styles.dot)} />
			{STATUS_LABELS[health.status]}
			{hasReasons ? <Info aria-hidden data-icon="inline-end" /> : null}
		</Badge>
	);

	if (!hasReasons) {
		return badge;
	}

	// A popover rather than a tooltip so the reasons also open on tap.
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					aria-label={`${STATUS_LABELS[health.status]}: show why`}
					className="rounded-4xl align-middle outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					type="button"
				>
					{badge}
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 text-sm" side="top">
				{health.reasons.length === 1 ? (
					<p>{health.reasons[0]}</p>
				) : (
					<ul className="flex list-disc flex-col gap-1 pl-4">
						{health.reasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}

function CopyCodeButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) {
			return;
		}
		const timeout = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timeout);
	}, [copied]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
		} catch {
			toast.error("Could not copy the code.");
		}
	}

	return (
		<>
			<Button
				aria-label={`Copy ${code}`}
				className="text-muted-foreground"
				onClick={copy}
				size="icon-xs"
				type="button"
				variant="ghost"
			>
				{copied ? <Check aria-hidden /> : <Copy aria-hidden />}
			</Button>
			<span aria-live="polite" className="sr-only">
				{copied ? `${code} copied` : ""}
			</span>
		</>
	);
}
