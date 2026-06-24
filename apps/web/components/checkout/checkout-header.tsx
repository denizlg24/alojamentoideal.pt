import { Button } from "@workspace/ui/components/button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/**
 * Compact checkout header: brand link home plus a circular back button to the
 * listing. Intentionally omits the full marketing nav so the visitor stays
 * focused on completing the booking.
 */
export function CheckoutHeader({ backHref }: { backHref: string }) {
	return (
		<header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
			<div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
				<Button
					aria-label="Go back"
					asChild
					className="rounded-full"
					size="icon"
					variant="outline"
				>
					<Link href={backHref}>
						<ChevronLeft className="size-4" />
					</Link>
				</Button>
				<Link
					className="font-heading font-semibold text-lg tracking-tight"
					href="/"
				>
					Alojamento Ideal
				</Link>
			</div>
		</header>
	);
}
