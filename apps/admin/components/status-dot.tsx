import { cn } from "@workspace/ui/lib/utils";

const STATUS_COLORS: Record<string, string> = {
	active: "bg-emerald-500",
	cancelled: "bg-red-400",
	canceled: "bg-red-400",
	completed: "bg-emerald-500",
	confirmed: "bg-emerald-500",
	draft: "bg-muted-foreground/40",
	failed: "bg-red-500",
	issued: "bg-emerald-500",
	pending: "bg-amber-500",
	retrying: "bg-amber-500",
	running: "bg-amber-500",
	succeeded: "bg-emerald-500",
};

/** Minimal status rendering: a colored dot plus the raw status text. */
export function StatusDot({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					STATUS_COLORS[status] ?? "bg-muted-foreground/40",
				)}
			/>
			{status}
		</span>
	);
}
