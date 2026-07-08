"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface PassengerStep {
	complete: boolean;
	content: ReactNode;
	key: string;
	label: string;
}

/**
 * One passenger at a time with a numbered step indicator, so a large party does
 * not turn into a long scroll of repeated question blocks. Steps are freely
 * navigable (the caller's submit gate still enforces completeness); the
 * indicator marks done passengers and flags any left empty once a submit is
 * attempted. Shared by the checkout questions form and the order hub's
 * post-booking questions editor.
 */
export function PassengerStepCarousel({
	steps,
	showErrors,
}: {
	steps: PassengerStep[];
	showErrors: boolean;
}) {
	const [step, setStep] = useState(0);
	const active = Math.min(step, steps.length - 1);
	const current = steps[active];
	if (!current) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-1.5">
				{steps.map((entry, index) => {
					const isActive = index === active;
					return (
						<button
							aria-current={isActive}
							aria-label={entry.label}
							className={cn(
								"flex size-7 items-center justify-center rounded-full border font-medium text-xs transition-colors",
								isActive
									? "border-primary bg-primary text-primary-foreground"
									: entry.complete
										? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
										: showErrors
											? "border-destructive text-destructive"
											: "border-border text-muted-foreground",
							)}
							key={entry.key}
							onClick={() => setStep(index)}
							type="button"
						>
							{entry.complete && !isActive ? (
								<Check className="size-3.5" />
							) : (
								index + 1
							)}
						</button>
					);
				})}
			</div>

			<div className="flex items-center justify-between">
				<p className="font-medium text-sm">{current.label}</p>
				<span className="text-muted-foreground text-xs">
					Guest {active + 1} of {steps.length}
				</span>
			</div>

			{current.content}

			<div className="flex items-center justify-between gap-2 pt-1">
				<Button
					disabled={active === 0}
					onClick={() => setStep((value) => Math.max(0, value - 1))}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ChevronLeft className="size-4" />
					Back
				</Button>
				<Button
					disabled={active >= steps.length - 1}
					onClick={() =>
						setStep((value) => Math.min(steps.length - 1, value + 1))
					}
					size="sm"
					type="button"
					variant="outline"
				>
					Next
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}
