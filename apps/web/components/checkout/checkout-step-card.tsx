import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type StepCardState = "active" | "complete" | "upcoming";

interface CheckoutStepCardProps {
	children?: ReactNode;
	onEdit?: () => void;
	state: StepCardState;
	stepNumber: number;
	summary?: ReactNode;
	title: string;
}

/**
 * Shared Airbnb-style step shell. Expanded (active) shows the body; collapsed
 * (complete) shows a compact summary with a "Change" affordance; upcoming steps
 * are dimmed.
 */
export function CheckoutStepCard({
	children,
	onEdit,
	state,
	stepNumber,
	summary,
	title,
}: CheckoutStepCardProps) {
	return (
		<section
			className={cn(
				"rounded-2xl border bg-card p-5 transition-opacity sm:p-6",
				state === "upcoming" && "opacity-60",
			)}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<span
						className={cn(
							"flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-sm",
							state === "complete"
								? "bg-foreground text-background"
								: "border text-muted-foreground",
						)}
					>
						{state === "complete" ? <Check className="size-4" /> : stepNumber}
					</span>
					<h2
						className={cn(
							"font-heading font-semibold",
							state === "active" ? "text-xl" : "text-base",
						)}
					>
						{title}
					</h2>
				</div>
				{state === "complete" && onEdit && (
					<Button onClick={onEdit} size="sm" variant="ghost">
						Change
					</Button>
				)}
			</div>
			{state === "active" && children && <div className="mt-5">{children}</div>}
			{state === "complete" && summary && (
				<div className="mt-2 pl-10 text-muted-foreground text-sm">
					{summary}
				</div>
			)}
		</section>
	);
}
