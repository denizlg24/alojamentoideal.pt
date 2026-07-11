"use client";

import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { findLocationPreset } from "@/lib/catalog/locations";
import { DateRangeField, StayCalendar } from "./date-range";
import { GuestFields, GuestSelector } from "./guest-selector";
import { LocationSelect } from "./location-select";
import { useStaySearch } from "./use-stay-search";

export function StaySearch({ className }: { className?: string }) {
	const { guestTotal, state, submit, update } = useStaySearch();
	const guests = useMemo(
		() => ({
			adults: state.adults,
			children: state.children,
			infants: state.infants,
			pets: state.pets,
		}),
		[state.adults, state.children, state.infants, state.pets],
	);
	const placeLabel = findLocationPreset(state.place)?.label ?? "Anywhere";

	return (
		<>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
				className={cn(
					"hidden w-full max-w-3xl items-center rounded-full border bg-white p-2 pl-2 text-foreground shadow-xl md:flex",
					className,
				)}
			>
				<LocationSelect
					className="flex-[1.3]"
					value={state.place}
					onChange={(place) => update({ place })}
				/>
				<Separator orientation="vertical" className="h-8" />
				<DateRangeField
					className="flex-1"
					value={state.range}
					onChange={(range) => update({ range })}
				/>
				<Separator orientation="vertical" className="h-8" />
				<GuestSelector
					className="flex-1"
					value={guests}
					onChange={(next) => update(next)}
				/>
				<Button
					type="submit"
					size="lg"
					className="ml-2 shrink-0 rounded-full px-6"
				>
					<Search className="size-4" />
					Search
				</Button>
			</form>

			<Sheet>
				<SheetTrigger asChild>
					<button
						type="button"
						className={cn(
							"flex w-full max-w-md items-center gap-3 rounded-full border bg-white px-5 py-3.5 text-left text-foreground shadow-xl md:hidden",
							className,
						)}
					>
						<Search className="size-5 shrink-0 text-primary" />
						<span className="flex flex-col">
							<span className="font-medium text-foreground text-sm">
								Search stays
							</span>
							<span className="text-muted-foreground text-xs">
								{placeLabel} · {guestTotal}{" "}
								{guestTotal === 1 ? "guest" : "guests"}
								{state.pets > 0
									? `, ${state.pets} ${state.pets === 1 ? "pet" : "pets"}`
									: ""}
							</span>
						</span>
					</button>
				</SheetTrigger>
				<SheetContent
					side="bottom"
					className="max-h-[90vh] gap-0 overflow-y-auto rounded-t-2xl"
				>
					<SheetHeader>
						<SheetTitle>Find your stay</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-5 px-4 pb-6">
						<div className="rounded-xl border py-2">
							<LocationSelect
								value={state.place}
								onChange={(place) => update({ place })}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<p className="font-medium text-sm">Dates</p>
							<div className="flex justify-center rounded-xl border p-2">
								<StayCalendar
									value={state.range}
									onChange={(range) => update({ range })}
									numberOfMonths={1}
								/>
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<p className="font-medium text-sm">Guests</p>
							<div className="rounded-xl border px-3">
								<GuestFields value={guests} onChange={(next) => update(next)} />
							</div>
						</div>

						<SheetClose asChild>
							<Button
								size="lg"
								className="w-full rounded-full"
								onClick={submit}
							>
								<Search className="size-4" />
								Search
							</Button>
						</SheetClose>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
