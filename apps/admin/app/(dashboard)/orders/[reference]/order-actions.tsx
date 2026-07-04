"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/status-dot";

interface OrderActionsProps {
	amountPaidMinor: number;
	amountRefundedMinor: number;
	reference: string;
	status: string;
}

async function postAction(
	reference: string,
	action: "accept" | "cancel" | "delete",
): Promise<{ ok: boolean; outcome: string | null; error: string | null }> {
	const response = await fetch(
		`/api/admin/orders/${encodeURIComponent(reference)}/${action}`,
		{ method: "POST" },
	);
	const body = (await response.json().catch(() => null)) as {
		data?: { outcome?: string };
		error?: string;
	} | null;
	return {
		error: body?.error ?? null,
		ok: response.ok,
		outcome: body?.data?.outcome ?? null,
	};
}

/**
 * Status display plus the manual saga actions. The status chip is optimistic:
 * it flips as soon as an action is submitted and settles on the server truth
 * after the refresh.
 */
export function OrderActions({
	amountPaidMinor,
	amountRefundedMinor,
	reference,
	status,
}: OrderActionsProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);

	const paid = amountPaidMinor > 0;
	const canAccept = optimisticStatus === "pending" && paid;
	const canCancel = ["draft", "pending", "confirmed"].includes(
		optimisticStatus,
	);
	const canDelete =
		!["pending", "confirmed"].includes(optimisticStatus) &&
		amountPaidMinor <= amountRefundedMinor;

	function run(action: "accept" | "cancel", optimistic: string) {
		startTransition(async () => {
			setOptimisticStatus(optimistic);
			const result = await postAction(reference, action);
			if (!result.ok) {
				toast.error(result.error ?? `Could not ${action} the order.`);
			} else if (result.outcome === "confirmed") {
				toast.success("Order confirmed.");
			} else if (
				result.outcome === "cancelled" ||
				result.outcome === "compensated"
			) {
				toast.success(
					paid ? "Order cancelled and refund issued." : "Order cancelled.",
				);
			} else {
				toast.info(
					`Action finished with outcome "${result.outcome ?? "unknown"}". Check the order state.`,
				);
			}
			router.refresh();
		});
	}

	function deleteOrder() {
		startTransition(async () => {
			const result = await postAction(reference, "delete");
			if (!result.ok) {
				toast.error(result.error ?? "Could not delete the order.");
				router.refresh();
				return;
			}

			toast.success("Order deleted.");
			router.replace("/orders");
			router.refresh();
		});
	}

	return (
		<div className="flex flex-wrap items-center gap-4">
			<StatusDot className="text-base" status={optimisticStatus} />
			<div className="flex items-center gap-2">
				{canAccept ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={pending} size="sm">
								Accept
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Accept this order?</AlertDialogTitle>
								<AlertDialogDescription>
									Confirms every provider hold with Hostify and settles the
									order. The guest receives the confirmation email.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep pending</AlertDialogCancel>
								<AlertDialogAction onClick={() => run("accept", "confirmed")}>
									Accept order
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
				{canCancel ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={pending} size="sm" variant="outline">
								Cancel order
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Cancel this order?</AlertDialogTitle>
								<AlertDialogDescription>
									{paid
										? "Releases every provider hold and refunds the full captured amount to the guest. This cannot be undone."
										: "Releases every provider hold and marks the order failed. This cannot be undone."}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep order</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => run("cancel", paid ? "cancelled" : "failed")}
								>
									{paid ? "Cancel and refund" : "Cancel order"}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
				{canDelete ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={pending} size="sm" variant="destructive">
								Delete order
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete this order?</AlertDialogTitle>
								<AlertDialogDescription>
									This permanently removes the order and its related local
									records from the admin database. This cannot be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep order</AlertDialogCancel>
								<AlertDialogAction onClick={deleteOrder} variant="destructive">
									Delete permanently
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
			</div>
		</div>
	);
}
