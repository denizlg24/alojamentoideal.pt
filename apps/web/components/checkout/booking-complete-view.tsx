"use client";

import type { OrderStatusResponse } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import * as api from "@/lib/checkout/api-client";
import { toCheckoutError } from "@/lib/checkout/errors";
import { formatMinor } from "@/lib/checkout/format";

type ViewState =
	| { status: "error"; message: string }
	| { status: "loading" }
	| { status: "ready"; order: OrderStatusResponse };

type Tone = "error" | "pending" | "success";

interface Presentation {
	body: string;
	tone: Tone;
	title: string;
}

/**
 * Renders booking completion using the server-verified order status. Payment
 * received and booking confirmed are shown as distinct states: payment can
 * settle before the Alojamento Ideal team finalizes the reservation.
 */
function present(order: OrderStatusResponse): Presentation {
	if (order.bookingStatus === "confirmed") {
		return {
			body: "Your stay is confirmed. We've emailed your booking details.",
			tone: "success",
			title: "Booking confirmed",
		};
	}

	switch (order.paymentStatus) {
		case "succeeded":
			return {
				body: "Payment received. The Alojamento Ideal team is finalizing your booking and will confirm by email shortly.",
				tone: "success",
				title: "Payment received",
			};
		case "processing":
			return {
				body: "Your payment is processing. We'll email you as soon as it settles and your booking is confirmed.",
				tone: "pending",
				title: "Payment processing",
			};
		case "requires_action":
			return {
				body: "Your payment needs an extra confirmation step. Please follow your bank's prompt, then refresh this page.",
				tone: "pending",
				title: "Action needed",
			};
		case "requires_payment_method":
		case "canceled":
			return {
				body: "Your payment was not completed. You can return to the home and try booking again.",
				tone: "error",
				title: "Payment not completed",
			};
		default:
			return {
				body: "We're still checking your payment. This page will reflect the latest status.",
				tone: "pending",
				title: "Checking your payment",
			};
	}
}

const TONE_ICON: Record<Tone, typeof CheckCircle2> = {
	error: AlertCircle,
	pending: Clock,
	success: CheckCircle2,
};

const TONE_COLOR: Record<Tone, string> = {
	error: "text-destructive",
	pending: "text-amber-600 dark:text-amber-400",
	success: "text-emerald-600 dark:text-emerald-400",
};

export function BookingCompleteView() {
	const searchParams = useSearchParams();
	const publicReference = searchParams.get("order");
	const [state, setState] = useState<ViewState>({ status: "loading" });

	useEffect(() => {
		if (!publicReference) {
			setState({
				message: "We could not find a booking reference in this link.",
				status: "error",
			});
			return;
		}

		let cancelled = false;
		const load = async () => {
			try {
				const order = await api.getOrderStatus(publicReference);
				if (!cancelled) {
					setState({ order, status: "ready" });
				}
			} catch (error) {
				if (!cancelled) {
					setState({
						message: toCheckoutError(error).message,
						status: "error",
					});
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [publicReference]);

	if (state.status === "loading") {
		return (
			<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16">
				<Skeleton className="size-12 rounded-full" />
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-64" />
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
				<AlertCircle className="size-12 text-destructive" />
				<h1 className="font-heading font-semibold text-xl">
					We could not load this booking
				</h1>
				<p className="text-muted-foreground text-sm">{state.message}</p>
				<Button asChild>
					<Link href="/homes">Browse homes</Link>
				</Button>
			</div>
		);
	}

	const { order } = state;
	const presentation = present(order);
	const Icon = TONE_ICON[presentation.tone];

	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
			<Icon className={`size-12 ${TONE_COLOR[presentation.tone]}`} />
			<h1 className="font-heading font-semibold text-2xl">
				{presentation.title}
			</h1>
			<p className="text-muted-foreground text-sm">{presentation.body}</p>

			<div className="mt-2 w-full rounded-2xl border bg-card p-5 text-left text-sm">
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">Reference</span>
					<span className="font-medium">{order.publicReference}</span>
				</div>
				<div className="mt-2 flex items-center justify-between">
					<span className="text-muted-foreground">Total</span>
					<span className="font-medium">
						{formatMinor(order.amountMinor, order.currency)}
					</span>
				</div>
			</div>

			<div className="mt-2 flex gap-3">
				<Button asChild>
					<Link href="/homes">Browse more homes</Link>
				</Button>
				{presentation.tone === "error" && (
					<Button asChild variant="outline">
						<Link href="/">Return home</Link>
					</Button>
				)}
			</div>
		</div>
	);
}
