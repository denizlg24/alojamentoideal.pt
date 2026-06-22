import { Button } from "@workspace/ui/components/button";
import { ArrowRight, Compass } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import illustration from "@/public/404_illustration.svg";

export const metadata: Metadata = {
	title: "Page not found",
	robots: { follow: true, index: false },
};

const HELPFUL_LINKS = [
	{
		description: "Start fresh from the front page",
		href: "/",
		label: "Homepage",
	},
	{
		description: "Cozy apartments along the North Coast",
		href: "/homes",
		label: "Homes",
	},
	{
		description: "Local tours and experiences",
		href: "/activities",
		label: "Activities",
	},
	{ description: "Answers to common questions", href: "/faq", label: "FAQ" },
] as const;

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="flex flex-1 items-center px-4 pt-16 pb-20 sm:px-6">
				<div className="mx-auto grid w-full max-w-5xl items-center gap-10 md:grid-cols-2 md:gap-12">
					<div className="flex flex-col items-center text-center md:items-start md:text-left">
						<p className="font-medium text-muted-foreground text-sm uppercase tracking-widest">
							Error 404
						</p>
						<h1 className="mt-2 font-heading font-semibold text-4xl tracking-tight sm:text-5xl">
							This page took a wrong turn
						</h1>
						<p className="mt-4 max-w-md text-balance text-muted-foreground">
							The page you were looking for isn't here. It may have moved, or
							the link might be out of date. Let's get you back to a stay that
							feels like home.
						</p>

						<div className="mt-8 flex flex-col gap-3 sm:flex-row">
							<Button asChild size="lg">
								<Link href="/homes">
									<Compass className="size-4" />
									Explore our homes
								</Link>
							</Button>
							<Button asChild size="lg" variant="outline">
								<Link href="/">
									Back to homepage
									<ArrowRight className="size-4" />
								</Link>
							</Button>
						</div>

						<nav
							aria-label="Helpful links"
							className="mt-10 flex w-full max-w-md flex-col divide-y border-t border-b"
						>
							{HELPFUL_LINKS.map((link) => (
								<Link
									key={link.href}
									href={link.href}
									className="group flex items-center gap-4 py-3 text-left transition-colors hover:text-foreground"
								>
									<span className="flex-1">
										<span className="block font-medium text-sm">
											{link.label}
										</span>
										<span className="block text-muted-foreground text-xs">
											{link.description}
										</span>
									</span>
									<ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
								</Link>
							))}
						</nav>
					</div>

					<div className="order-first mx-auto w-full max-w-sm md:order-last md:max-w-none">
						<Image
							src={illustration}
							alt="Page not found illustration"
							priority
							className="h-auto w-full"
						/>
					</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
