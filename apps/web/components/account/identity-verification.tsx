"use client";

import type {
	AccountProfile,
	IdentityVerificationStatus,
} from "@workspace/core/account";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import { getStripe, isStripeConfigured } from "@/lib/checkout/stripe";
import { AccountSection } from "./account-ui";

interface IdentitySessionResponse {
	clientSecret: string | null;
	status: IdentityVerificationStatus;
}

const PILL_TONE: Record<IdentityVerificationStatus, string> = {
	unstarted: "bg-muted text-muted-foreground",
	processing: "bg-amber-100 text-amber-800",
	requires_input: "bg-amber-100 text-amber-800",
	verified: "bg-emerald-100 text-emerald-800",
	canceled: "bg-muted text-muted-foreground",
};

const PILL_LABEL: Record<IdentityVerificationStatus, string> = {
	unstarted: "Not verified",
	processing: "In review",
	requires_input: "Action needed",
	verified: "Verified",
	canceled: "Not verified",
};

function helperText(status: IdentityVerificationStatus): string {
	switch (status) {
		case "verified":
			return "Your identity has been verified. Thank you.";
		case "processing":
			return "We're reviewing your document. This usually takes a few minutes.";
		case "requires_input":
			return "We couldn't verify your last attempt. Please try again.";
		default:
			return "Verify your identity once so future bookings are faster and more secure. You'll need a government ID and your device camera.";
	}
}

export function IdentityVerification({
	initialStatus,
	initialVerifiedAt,
}: {
	initialStatus: IdentityVerificationStatus;
	initialVerifiedAt: string | null;
}) {
	const [status, setStatus] =
		useState<IdentityVerificationStatus>(initialStatus);
	const [verifiedAt, setVerifiedAt] = useState<string | null>(
		initialVerifiedAt,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// When Stripe redirects back with ?identity=complete (hosted fallback), pull
	// the authoritative status the webhook has recorded. Failures are non-fatal:
	// the page keeps showing the last known status.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("identity") !== "complete") {
			return;
		}

		let cancelled = false;
		void (async () => {
			const response = await fetch("/api/account/profile").catch(() => null);
			if (!response?.ok || cancelled) {
				return;
			}
			const profile = (await response
				.json()
				.catch(() => null)) as AccountProfile | null;
			if (!profile || cancelled) {
				return;
			}
			setStatus(profile.identityStatus);
			setVerifiedAt(profile.identityVerifiedAt);
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	async function startVerification() {
		setError(null);
		setBusy(true);
		try {
			const response = await fetch("/api/account/identity-session", {
				method: "POST",
			});
			if (!response.ok) {
				setError("Identity verification isn't available right now.");
				return;
			}
			const session = (await response.json()) as IdentitySessionResponse;
			if (!session.clientSecret) {
				setError("Identity verification isn't available right now.");
				return;
			}

			const stripe = await getStripe();
			if (!stripe) {
				setError("Identity verification isn't available right now.");
				return;
			}

			const result = await stripe.verifyIdentity(session.clientSecret);
			if (result.error) {
				setError(result.error.message ?? "Verification was not completed.");
				return;
			}

			// The session is submitted; Stripe processes it asynchronously and the
			// webhook records the final status. Reflect "in review" immediately.
			setStatus("processing");
		} catch {
			setError("Something went wrong starting verification.");
		} finally {
			setBusy(false);
		}
	}

	const configured = isStripeConfigured();
	const showButton = status !== "verified" && status !== "processing";
	const buttonLabel =
		status === "requires_input" || status === "canceled"
			? "Try again"
			: "Verify identity";

	return (
		<AccountSection
			title="Identity verification"
			description="A one-time check, handled securely by Stripe. We never store your document."
		>
			<div className="flex flex-wrap items-center gap-3">
				<span
					className={cn(
						"inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs",
						PILL_TONE[status],
					)}
				>
					{PILL_LABEL[status]}
				</span>
				{status === "verified" && verifiedAt && (
					<span className="text-muted-foreground text-xs">
						on {new Date(verifiedAt).toLocaleDateString()}
					</span>
				)}
			</div>

			<p className="text-muted-foreground text-sm leading-relaxed">
				{helperText(status)}
			</p>

			{error && <p className="text-destructive text-sm">{error}</p>}

			{showButton && (
				<div>
					<Button
						disabled={busy || !configured}
						onClick={startVerification}
						type="button"
						variant="outline"
					>
						{busy ? "Starting…" : buttonLabel}
					</Button>
					{!configured && (
						<p className="mt-1.5 text-muted-foreground text-xs">
							Verification is temporarily unavailable.
						</p>
					)}
				</div>
			)}
		</AccountSection>
	);
}
