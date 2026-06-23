import type { ReactNode } from "react";

/**
 * Two-column checkout shell on desktop (step flow left, sticky reservation
 * summary right) collapsing to a single stacked column on mobile, where the
 * summary sits above the steps.
 */
export function CheckoutLayout({
	steps,
	summary,
}: {
	steps: ReactNode;
	summary: ReactNode;
}) {
	return (
		<div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
			<div className="order-2 flex flex-col gap-4 lg:order-1">{steps}</div>
			<aside className="order-1 lg:sticky lg:top-24 lg:order-2 lg:self-start">
				{summary}
			</aside>
		</div>
	);
}
