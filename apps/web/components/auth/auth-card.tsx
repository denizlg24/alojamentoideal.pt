import Link from "next/link";
import type { ReactNode } from "react";

interface AuthCardProps {
	children: ReactNode;
	footer?: ReactNode;
	subtitle?: string;
	title: string;
}

/** Centered card shell shared by all auth screens. */
export function AuthCard({ children, footer, subtitle, title }: AuthCardProps) {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
			<div className="text-center">
				<Link
					className="font-heading font-semibold text-lg tracking-tight"
					href="/"
				>
					Alojamento Ideal
				</Link>
			</div>
			<div className="rounded-2xl border bg-card p-6 shadow-sm">
				<div className="mb-5 flex flex-col gap-1 text-center">
					<h1 className="font-heading font-semibold text-2xl">{title}</h1>
					{subtitle && (
						<p className="text-muted-foreground text-sm">{subtitle}</p>
					)}
				</div>
				{children}
			</div>
			{footer && (
				<div className="text-center text-muted-foreground text-sm">
					{footer}
				</div>
			)}
		</div>
	);
}
