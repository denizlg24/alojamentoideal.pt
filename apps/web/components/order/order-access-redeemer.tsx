"use client";

import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/home/site-header";
import { OrderAccessDenied } from "./order-access-denied";

type RedeemResult = { ok: false; reason: "full" | "invalid" };
type RedeemAction = (reference: string, token: string) => Promise<RedeemResult>;

/**
 * Redeems the `?token` magic link on mount, then leaves the rest to the action:
 * on success it sets the member cookie and redirects to the clean URL (this
 * component unmounts with the navigation); only a failure resolves, which swaps
 * in the access-denied surface. The token never reaches client state beyond the
 * single action call.
 */
export function OrderAccessRedeemer({
	action,
	reference,
	token,
}: {
	action: RedeemAction;
	reference: string;
	token: string;
}) {
	const [failure, setFailure] = useState<"full" | "invalid" | null>(null);

	useEffect(() => {
		let cancelled = false;
		void action(reference, token)
			.then((result) => {
				if (!cancelled && result && !result.ok) {
					setFailure(result.reason);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setFailure("invalid");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [action, reference, token]);

	if (failure) {
		return <OrderAccessDenied reason={failure} />;
	}

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="grid flex-1 place-items-center px-4 pt-24 pb-16">
				<div className="flex flex-col items-center gap-3 text-center">
					<Spinner className="size-6 text-muted-foreground" />
					<p className="text-muted-foreground text-sm">
						Unlocking your booking…
					</p>
				</div>
			</main>
		</div>
	);
}
