"use client";

import type { OrderStatusResponse } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { AlertCircle, CheckCircle2, Clock, Info } from "lucide-react";
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

type Tone = "error" | "info" | "pending" | "success";

interface Presentation {
	body: string;
	tone: Tone;
	title: string;
}

/** Poll the server-verified status until the order reaches a terminal state. */
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20;

/**
 * A terminal order no longer changes on its own, so polling can stop. A booking
 * that confirmed, was refunded (`cancelled`) or released (`failed`) is settled;
 * an unpaid order is settled only once Stripe reports the payment can't proceed.
 */
function isTerminal(order: OrderStatusResponse): boolean {
	if (
		order.bookingStatus === "confirmed" ||
		order.bookingStatus === "cancelled" ||
		order.bookingStatus === "failed"
	) {
		return true;
	}
	return (
		order.paymentStatus === "requires_payment_method" ||
		order.paymentStatus === "canceled"
	);
}

/**
 * Renders booking completion using the server-verified order status. Booking
 * lifecycle wins over raw payment status: a refunded order keeps a `succeeded`
 * PaymentIntent, so it must be read from `bookingStatus`, not payment state.
 * Payment received and booking confirmed stay distinct: payment can settle
 * before the Alojamento Ideal team finalizes the reservation.
 */
function present(order: OrderStatusResponse): Presentation {
	switch (order.bookingStatus) {
		case "confirmed":
			return {
				body: "Your stay is confirmed. We've emailed your booking details.",
				tone: "success",
				title: "Booking confirmed",
			};
		case "cancelled":
			return {
				body: "We couldn't confirm this booking, so we cancelled it and refunded you in full. The refund is on its way back to your original payment method and can take a few business days to appear.",
				tone: "info",
				title: "Refunded in full",
			};
		case "failed":
			return {
				body: "This booking could not be completed and you have not been charged. You can return to the home and try booking again.",
				tone: "error",
				title: "Booking not completed",
			};
		default:
			break;
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
				body: "Your payment needs an extra confirmation step. Please follow your bank's prompt, then return to this page.",
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
				body: "We're still checking your payment. This page will update as soon as the status changes.",
				tone: "pending",
				title: "Checking your payment",
			};
	}
}

const TONE_ICON: Record<Tone, typeof CheckCircle2> = {
	error: AlertCircle,
	info: Info,
	pending: Clock,
	success: CheckCircle2,
};

const TONE_COLOR: Record<Tone, string> = {
	error: "text-destructive",
	info: "text-sky-600 dark:text-sky-400",
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
		let attempts = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const poll = async () => {
			try {
				const order = await api.getOrderStatus(publicReference);
				if (cancelled) {
					return;
				}
				setState({ order, status: "ready" });
				attempts += 1;
				if (!isTerminal(order) && attempts < MAX_POLLS) {
					timer = setTimeout(poll, POLL_INTERVAL_MS);
				}
			} catch (error) {
				if (cancelled) {
					return;
				}
				// Keep the last good status visible if a later poll fails; only the very
				// first load failure surfaces the error screen.
				setState((prev) =>
					prev.status === "ready"
						? prev
						: { message: toCheckoutError(error).message, status: "error" },
				);
			}
		};

		void poll();
		return () => {
			cancelled = true;
			if (timer) {
				clearTimeout(timer);
			}
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
	const isRefunded = order.bookingStatus === "cancelled";
	const amountLabel = isRefunded ? "Refunded" : "Total";
	const amountValue = isRefunded ? order.amountPaidMinor : order.amountMinor;

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
					<span className="text-muted-foreground">{amountLabel}</span>
					<span className="font-medium">
						{formatMinor(amountValue, order.currency)}
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
