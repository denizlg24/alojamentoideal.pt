import { Button } from "@workspace/ui/components/button";
import { ArrowRight, Compass, House } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

export const metadata: Metadata = {
	title: "Home not found",
	robots: { follow: true, index: false },
};

const SUGGESTED_LOCATIONS = [
	{ id: "porto", label: "Porto" },
	{ id: "povoa-de-varzim", label: "Póvoa de Varzim" },
	{ id: "leca-da-palmeira", label: "Leça da Palmeira" },
	{ id: "canidelo", label: "Canidelo" },
] as const;

export default function ListingNotFound() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="flex flex-1 items-center justify-center px-4 pt-16 pb-20 sm:px-6">
				<div className="flex w-full max-w-xl flex-col items-center text-center">
					<span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<House className="size-7" />
					</span>
					<p className="mt-6 font-medium text-muted-foreground text-sm uppercase tracking-widest">
						Error 404
					</p>
					<h1 className="mt-2 font-heading font-semibold text-3xl tracking-tight sm:text-4xl">
						This home isn't available
					</h1>
					<p className="mt-4 max-w-md text-balance text-muted-foreground">
						We couldn't find the apartment you were looking for. It may have
						been unlisted, or the link might be out of date. Our other homes
						along the North Coast are ready when you are.
					</p>

					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<Button asChild size="lg">
							<Link href="/homes">
								<Compass className="size-4" />
								Browse all homes
							</Link>
						</Button>
						<Button asChild size="lg" variant="outline">
							<Link href="/">
								Back to homepage
								<ArrowRight className="size-4" />
							</Link>
						</Button>
					</div>

					<div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm">
						<span className="text-muted-foreground">Popular stays in</span>
						{SUGGESTED_LOCATIONS.map((location) => (
							<Link
								key={location.id}
								href={`/homes?place=${location.id}`}
								className="rounded-full border px-3 py-1 text-foreground transition-colors hover:bg-accent"
							>
								{location.label}
							</Link>
						))}
					</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
