import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@workspace/ui/components/alert";
import { CircleAlert, PlugZap } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { listAdminPromotionCodes } from "@/lib/promotions";
import {
	CreatePromotionProvider,
	NewPromotionButton,
} from "./create-promotion-dialog";
import { PromotionCodesTable } from "./promotion-codes-table";
import { toPromotionCodeView } from "./promotion-display";

export const metadata: Metadata = { title: "Promotions" };

function PromotionsHeader({ action }: { action?: ReactNode }) {
	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
			<div>
				<h1 className="font-display font-semibold text-xl tracking-tight">
					Promotions
				</h1>
				<p className="mt-1 max-w-2xl text-muted-foreground text-sm">
					Discount codes guests enter at checkout. Codes live in Stripe;
					restrictions here decide whether a code covers homes, activities or
					both.
				</p>
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);
}

export default async function PromotionsPage() {
	const list = await listAdminPromotionCodes();

	if (list.status === "stripe_unconfigured") {
		return (
			<div className="mx-auto max-w-6xl">
				<PromotionsHeader />
				<Alert className="mt-6">
					<PlugZap aria-hidden />
					<AlertTitle>Promotion codes are unavailable</AlertTitle>
					<AlertDescription>
						Stripe is not configured for this environment, so promotion codes
						cannot be listed or created.
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	if (list.status === "stripe_error") {
		return (
			<div className="mx-auto max-w-6xl">
				<PromotionsHeader />
				<Alert className="mt-6" variant="destructive">
					<CircleAlert aria-hidden />
					<AlertTitle>Could not load promotion codes from Stripe</AlertTitle>
					<AlertDescription>
						<p className="break-words">{list.message}</p>
						<p>Reload the page to try again.</p>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-6xl">
			<CreatePromotionProvider currency={list.currency}>
				<PromotionsHeader action={<NewPromotionButton />} />
				<PromotionCodesTable
					codes={list.codes.map(toPromotionCodeView)}
					currency={list.currency}
				/>
			</CreatePromotionProvider>
		</div>
	);
}
