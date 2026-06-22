import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";

/**
 * Static, non-animated stand-in for the listings map. Used both as the cold-load
 * skeleton's map and as the loading fallback while the Leaflet chunk downloads,
 * so the map area reads as a real (if inert) map rather than a pulsing skeleton.
 */
export function MapPlaceholder({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn(
				"flex h-full w-full items-center justify-center bg-muted",
				className,
			)}
		>
			<MapPin className="size-8 text-muted-foreground/40" />
		</div>
	);
}
