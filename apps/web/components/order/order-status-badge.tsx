import type { OrderProvisioningSubState } from "@workspace/core/commerce";
import { cn } from "@workspace/ui/lib/utils";

const STATUS_PRESENTATION: Record<
	OrderProvisioningSubState,
	{ className: string; label: string }
> = {
	cancelled: {
		className: "bg-muted text-muted-foreground",
		label: "Cancelled",
	},
	confirmed: {
		className: "bg-emerald-100 text-emerald-800",
		label: "Confirmed",
	},
	"held-unpaid": {
		className: "bg-amber-100 text-amber-800",
		label: "Awaiting payment",
	},
	"paid-confirming": {
		className: "bg-amber-100 text-amber-800",
		label: "Finalizing",
	},
	refunded: {
		className: "bg-sky-100 text-sky-800",
		label: "Refunded",
	},
};

export function OrderStatusBadge({
	state,
	className,
}: {
	state: OrderProvisioningSubState;
	className?: string;
}) {
	const presentation = STATUS_PRESENTATION[state];
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs",
				presentation.className,
				className,
			)}
		>
			{presentation.label}
		</span>
	);
}
