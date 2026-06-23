"use client";

import { Button } from "@workspace/ui/components/button";
import Link from "next/link";
import { useEffect } from "react";

export default function BookError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Checkout route error", error);
	}, [error]);

	return (
		<div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
			<h1 className="font-heading font-semibold text-xl">
				Something interrupted your checkout
			</h1>
			<p className="text-muted-foreground text-sm">
				We hit an unexpected error. You can try again, or head back to the home
				and start over.
			</p>
			<div className="flex gap-3">
				<Button onClick={reset}>Try again</Button>
				<Button asChild variant="outline">
					<Link href="/">Return to home</Link>
				</Button>
			</div>
		</div>
	);
}
