import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * One settings section laid out as a label column beside its content. Sections
 * are separated by a hairline top border rather than enclosed in cards, keeping
 * the page clean and flat. Shared by the live account view and its skeleton so
 * the prerendered shell matches the streamed content exactly.
 */
export function AccountSection({
	title,
	description,
	children,
	className,
}: {
	title: string;
	description?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"grid gap-x-10 gap-y-5 border-border/60 border-t py-8 sm:grid-cols-[210px_1fr] sm:py-10",
				className,
			)}
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">{title}</h2>
				{description && (
					<p className="text-muted-foreground text-sm leading-relaxed">
						{description}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-5">{children}</div>
		</section>
	);
}

/** Read-only label/value pair used for fields the user cannot edit here. */
export function ReadField({
	label,
	value,
}: {
	label: string;
	value: ReactNode;
}) {
	return (
		<>
			<dt className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</dt>
			<dd className="mb-4 text-sm last:mb-0 sm:mb-0">{value}</dd>
		</>
	);
}
