"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Info, TicketPercent } from "lucide-react";
import { useState } from "react";
import { NewPromotionButton } from "./create-promotion-dialog";
import { PromotionCodeRow } from "./promotion-code-row";
import {
	isPromotionFilter,
	matchesFilter,
	PROMOTION_FILTERS,
	type PromotionCodeView,
	type PromotionFilter,
	promotionHealth,
} from "./promotion-display";

const FILTER_EMPTY_STATES: Record<
	Exclude<PromotionFilter, "all">,
	{ description: string; title: string }
> = {
	active: {
		description: "Every code is inactive or expired.",
		title: "No active codes",
	},
	inactive: {
		description: "Every code is currently live.",
		title: "No inactive codes",
	},
};

interface PromotionCodesTableProps {
	codes: PromotionCodeView[];
	currency: string;
}

export function PromotionCodesTable({
	codes,
	currency,
}: PromotionCodesTableProps) {
	const rows = codes.map((code) => ({
		code,
		status: promotionHealth(code, currency).status,
	}));
	const counts: Record<PromotionFilter, number> = {
		active: rows.filter((row) => matchesFilter(row.status, "active")).length,
		all: rows.length,
		inactive: rows.filter((row) => matchesFilter(row.status, "inactive"))
			.length,
	};

	const [filter, setFilter] = useState<PromotionFilter>(() =>
		counts.active > 0 || counts.all === 0 ? "active" : "all",
	);
	// Toggled codes stay visible until the filter changes, instead of vanishing
	// from under the pointer once the refreshed list arrives.
	const [toggledIds, setToggledIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	if (codes.length === 0) {
		return (
			<Empty className="mt-6 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TicketPercent aria-hidden />
					</EmptyMedia>
					<EmptyTitle>No promotion codes yet</EmptyTitle>
					<EmptyDescription>
						Create a code to offer a discount on homes, activities or both.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<NewPromotionButton />
				</EmptyContent>
			</Empty>
		);
	}

	const visibleRows = rows.filter(
		(row) => matchesFilter(row.status, filter) || toggledIds.has(row.code.id),
	);

	function changeFilter(next: PromotionFilter) {
		setFilter(next);
		setToggledIds(new Set());
	}

	return (
		<>
			<ToggleGroup
				aria-label="Show codes"
				className="mt-6"
				onValueChange={(next) => {
					if (isPromotionFilter(next)) {
						changeFilter(next);
					}
				}}
				size="sm"
				spacing={0}
				type="single"
				value={filter}
				variant="outline"
			>
				{PROMOTION_FILTERS.map((option) => (
					<ToggleGroupItem key={option.value} value={option.value}>
						{option.label}
						<span className="text-muted-foreground tabular-nums">
							{counts[option.value]}
						</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>

			{visibleRows.length === 0 && filter !== "all" ? (
				<Empty className="mt-4 border">
					<EmptyHeader>
						<EmptyTitle>{FILTER_EMPTY_STATES[filter].title}</EmptyTitle>
						<EmptyDescription>
							{FILTER_EMPTY_STATES[filter].description}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							onClick={() => changeFilter("all")}
							type="button"
							variant="outline"
						>
							Show all codes
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<div className="mt-4 overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Code</TableHead>
								<TableHead>Discount</TableHead>
								<TableHead>Applies to</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>
									<span className="inline-flex items-center gap-1">
										Used
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													aria-label="How usage is counted"
													className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
													type="button"
												>
													<Info aria-hidden className="size-3.5" />
												</button>
											</TooltipTrigger>
											<TooltipContent>
												Paid orders on this site. Stripe does not count these
												redemptions.
											</TooltipContent>
										</Tooltip>
									</span>
								</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="text-right">Active</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visibleRows.map((row) => (
								<PromotionCodeRow
									code={row.code}
									currency={currency}
									key={row.code.id}
									onToggle={(id) =>
										setToggledIds((current) =>
											current.has(id) ? current : new Set(current).add(id),
										)
									}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
