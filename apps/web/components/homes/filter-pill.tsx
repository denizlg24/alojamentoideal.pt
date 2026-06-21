import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

export function FilterPill({
	active = false,
	children,
	className,
	onClick,
}: {
	active?: boolean;
	children: ReactNode;
	className?: string;
	onClick?: () => void;
}) {
	const classes = cn(
		"rounded-full border px-4 py-2 font-medium text-sm transition-colors",
		active
			? "border-foreground bg-accent text-foreground"
			: "border-input text-muted-foreground",
		onClick && "hover:border-foreground hover:text-foreground",
		className,
	);

	if (!onClick) {
		return <span className={classes}>{children}</span>;
	}

	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={classes}
		>
			{children}
		</button>
	);
}
