import { Skeleton } from "@workspace/ui/components/skeleton";
import { AccountSection } from "./account-ui";

function FieldSkeleton({ labelWidth = "w-24" }: { labelWidth?: string }) {
	return (
		<div className="flex flex-col gap-1.5">
			<Skeleton className={`h-3.5 ${labelWidth}`} />
			<Skeleton className="h-9 w-full rounded-4xl" />
		</div>
	);
}

function TwoColumn({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
	);
}

/**
 * Prerendered shell for the account page. The section structure, headings and
 * descriptions are known at build time; only the user's values stream in, so
 * those are the only placeholders here.
 */
export function AccountSkeleton() {
	return (
		<>
			<header className="pb-2">
				<Skeleton className="h-9 w-48" />
				<Skeleton className="mt-2 h-4 w-80 max-w-full" />
			</header>

			<AccountSection
				title="Profile"
				description="Your name and the email you sign in with."
			>
				<div className="flex items-center gap-4">
					<Skeleton className="size-16 rounded-full" />
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-8 w-28" />
						<Skeleton className="h-3 w-40" />
					</div>
				</div>
				<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<FieldSkeleton labelWidth="w-12" />
					<FieldSkeleton labelWidth="w-16" />
					<FieldSkeleton labelWidth="w-24" />
				</div>
			</AccountSection>

			<AccountSection
				title="Contact"
				description="How the Alojamento Ideal team reaches you about your stay."
			>
				<FieldSkeleton labelWidth="w-28" />
			</AccountSection>

			<AccountSection
				title="Billing"
				description="Used to issue invoices for your bookings."
			>
				<Skeleton className="h-5 w-64 max-w-full" />
				<FieldSkeleton labelWidth="w-20" />
				<FieldSkeleton labelWidth="w-40" />
				<TwoColumn>
					<FieldSkeleton labelWidth="w-12" />
					<FieldSkeleton labelWidth="w-20" />
				</TwoColumn>
				<TwoColumn>
					<FieldSkeleton labelWidth="w-20" />
					<FieldSkeleton labelWidth="w-16" />
				</TwoColumn>
			</AccountSection>

			<AccountSection
				title="Residence"
				description="Where you live and your nationality, for your guest profile."
			>
				<TwoColumn>
					<FieldSkeleton labelWidth="w-32" />
					<FieldSkeleton labelWidth="w-20" />
				</TwoColumn>
			</AccountSection>

			<AccountSection
				title="Identity verification"
				description="A one-time check, handled securely by Stripe. We never store your document."
			>
				<Skeleton className="h-5 w-24 rounded-full" />
				<Skeleton className="h-4 w-full max-w-md" />
				<Skeleton className="h-9 w-32" />
			</AccountSection>
		</>
	);
}
