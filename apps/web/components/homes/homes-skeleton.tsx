import { cn } from "@workspace/ui/lib/utils";
import {
	ArrowLeft,
	CalendarDays,
	MapPin,
	SlidersHorizontal,
	Users,
} from "lucide-react";
import { ListingCardSkeleton } from "@/components/listings/listing-card";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";
import { MapPlaceholder } from "./map-placeholder";

const CARD_SKELETON_KEYS = ["a", "b", "c", "d", "e", "f"];

const RAIL_CHIP_BASE =
	"shrink-0 whitespace-nowrap rounded-full border px-4 py-2 font-medium text-sm";

/**
 * Inert copy of the location rail: same chips and layout as the real one, with
 * no navigation wired up.
 */
function StaticLocationRail() {
	return (
		<div aria-hidden className="hidden sm:block">
			<div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				<span
					className={cn(
						RAIL_CHIP_BASE,
						"flex items-center gap-1.5 border-primary bg-primary text-primary-foreground shadow-sm",
					)}
				>
					<MapPin className="size-3.5" />
					All areas
				</span>
				{CATALOG_LOCATION_PRESETS.map((preset) => (
					<span
						key={preset.id}
						className={cn(
							RAIL_CHIP_BASE,
							"border-border bg-card text-foreground",
						)}
					>
						{preset.label}
					</span>
				))}
			</div>
		</div>
	);
}

function StaticField({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="flex flex-1 items-center gap-2 px-3 py-1">
			{icon}
			<span className="flex flex-col items-start">
				<span className="font-medium text-muted-foreground text-xs">
					{label}
				</span>
				<span className="text-muted-foreground text-sm">{value}</span>
			</span>
		</div>
	);
}

/**
 * Inert copy of the homes filter bar for both breakpoints: the compact mobile
 * search row and the desktop pill (dates / guests / filters), with no popovers
 * or navigation wired up.
 */
function StaticFilterBar() {
	return (
		<div aria-hidden>
			<div className="flex items-center gap-2 sm:hidden">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground">
					<ArrowLeft className="size-5" />
				</div>
				<div className="flex flex-1 flex-col items-center rounded-full border bg-card px-4 py-2 text-center shadow-sm">
					<span className="font-medium text-sm">Anywhere</span>
					<span className="text-muted-foreground text-xs">
						Any week · Add guests
					</span>
				</div>
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full border">
					<SlidersHorizontal className="size-4" />
				</div>
			</div>

			<div className="hidden items-center gap-2 rounded-full border bg-card p-2 shadow-sm sm:flex">
				<StaticField
					icon={
						<CalendarDays className="size-4 shrink-0 text-muted-foreground" />
					}
					label="Dates"
					value="Add dates"
				/>
				<div className="h-8 w-px shrink-0 bg-border" />
				<StaticField
					icon={<Users className="size-4 shrink-0 text-muted-foreground" />}
					label="Guests"
					value="Add guests"
				/>
				<div className="flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 font-medium text-sm">
					<SlidersHorizontal className="size-4" />
					Filters
				</div>
			</div>
		</div>
	);
}

/**
 * Cold-load fallback for the homes search. The chrome (location rail, filter
 * bar, map) renders as inert stand-ins so only the listing cards read as
 * loading, keeping the first paint representative of the real layout.
 */
export function HomesSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4">
				<StaticLocationRail />
				<StaticFilterBar />
			</div>

			<div className="h-72 overflow-hidden rounded-2xl border shadow-sm lg:hidden">
				<MapPlaceholder />
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(340px,400px)]">
				<div className="flex flex-col gap-4">
					{CARD_SKELETON_KEYS.map((key) => (
						<ListingCardSkeleton key={key} layout="row" />
					))}
				</div>
				<aside className="hidden lg:block">
					<div className="sticky top-24 h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border shadow-sm">
						<MapPlaceholder />
					</div>
				</aside>
			</div>
		</div>
	);
}
