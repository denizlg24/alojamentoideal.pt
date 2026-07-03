import { cn } from "@workspace/ui/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";

type AlertVariant = "error" | "info" | "success" | "warning";

interface CheckoutAlertProps {
	children: ReactNode;
	title?: string;
	variant?: AlertVariant;
}

const VARIANT_STYLES: Record<AlertVariant, string> = {
	error: "border-destructive/30 bg-destructive/10 text-destructive",
	info: "border-border bg-muted text-foreground",
	success:
		"border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
	warning:
		"border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

const VARIANT_ICON: Record<AlertVariant, typeof Info> = {
	error: AlertCircle,
	info: Info,
	success: CheckCircle2,
	warning: AlertTriangle,
};

/** Normalized inline notice for checkout errors and quote-refresh messages. */
export function CheckoutAlert({
	children,
	title,
	variant = "info",
}: CheckoutAlertProps) {
	const Icon = VARIANT_ICON[variant];
	return (
		<div
			className={cn(
				"flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
				VARIANT_STYLES[variant],
			)}
			role={variant === "error" ? "alert" : "status"}
		>
			<Icon className="mt-0.5 size-4 shrink-0" />
			<div className="flex flex-col gap-0.5">
				{title && <span className="font-medium">{title}</span>}
				<span className="text-sm">{children}</span>
			</div>
		</div>
	);
}
