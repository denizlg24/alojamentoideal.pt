import { Button } from "@workspace/ui/components/button";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

export default function ActivityNotFound() {
	return (
		<div className="flex min-h-svh flex-col">
			<SiteHeader />
			<main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
				<h1 className="font-heading font-semibold text-2xl">
					Activity not found
				</h1>
				<p className="text-muted-foreground">
					This activity is no longer available or the link is incorrect.
				</p>
				<Button asChild>
					<Link href="/activities">Browse all activities</Link>
				</Button>
			</main>
			<SiteFooter />
		</div>
	);
}
