"use client";

import type {
	AccountIdentityDocumentDisplay,
	AccountProfile,
	IdentityVerificationStatus,
} from "@workspace/core/account";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getStripe, isStripeConfigured } from "@/lib/checkout/stripe";
import { AccountSection, ReadField } from "./account-ui";

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

const HOSTED_RETURN_POLL_ATTEMPTS = 8;
const HOSTED_RETURN_POLL_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function helperText(status: IdentityVerificationStatus): string {
	switch (status) {
		case "verified":
			return "Your identity has been verified. Selected document details are stored encrypted for booking prefill and compliance workflows.";
		case "processing":
			return "We're reviewing your document. Selected details are stored encrypted only after verification succeeds.";
		case "requires_input":
			return "We couldn't verify your last attempt. Please try again.";
		case "canceled":
			return "Verification was canceled. You can reset the flow or start again when ready.";
		default:
			return "Verify your identity once so future bookings are faster. You'll need a government ID and your device camera.";
	}
}

function formatDate(value: string | null): string {
	if (!value) {
		return "Not available";
	}
	const date = new Date(
		/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
	);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleDateString("en", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

function valueOrFallback(value: string | null): string {
	return value ?? "Not available";
}

function resetButtonLabel(status: IdentityVerificationStatus): string {
	switch (status) {
		case "verified":
			return "Delete ID data";
		case "processing":
			return "Cancel and reset";
		default:
			return "Reset";
	}
}

export function IdentityVerification({
	initialIdentity,
}: {
	initialIdentity: AccountIdentityDocumentDisplay;
}) {
	const [identity, setIdentity] =
		useState<AccountIdentityDocumentDisplay>(initialIdentity);
	const [busy, setBusy] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const status = identity.status;

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
			const initialStatus = initialIdentity.status;
			setIdentity((current) =>
				current.status === "verified"
					? current
					: { ...current, status: "processing", verifiedAt: null },
			);

			for (
				let attempt = 0;
				attempt < HOSTED_RETURN_POLL_ATTEMPTS;
				attempt += 1
			) {
				if (attempt > 0) {
					await sleep(HOSTED_RETURN_POLL_DELAY_MS);
				}
				const response = await fetch("/api/account/profile").catch(() => null);
				if (!response?.ok || cancelled) {
					continue;
				}
				const profile = (await response
					.json()
					.catch(() => null)) as AccountProfile | null;
				if (!profile || cancelled) {
					continue;
				}
				if (
					profile.identity.status !== initialStatus ||
					attempt === HOSTED_RETURN_POLL_ATTEMPTS - 1
				) {
					setIdentity(profile.identity);
					return;
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [initialIdentity.status]);

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
			setIdentity((current) => ({
				...current,
				status: "processing",
				verifiedAt: null,
			}));
		} catch {
			setError("Something went wrong starting verification.");
		} finally {
			setBusy(false);
		}
	}

	async function resetVerification() {
		setError(null);
		setResetting(true);
		try {
			const response = await fetch("/api/account/identity-session", {
				method: "DELETE",
			});
			if (!response.ok) {
				setError("We couldn't reset identity verification right now.");
				return;
			}

			const profile = (await response.json()) as AccountProfile;
			setIdentity(profile.identity);
		} catch {
			setError("We couldn't reach the server. Please try again.");
		} finally {
			setResetting(false);
		}
	}

	const configured = isStripeConfigured();
	const actionBusy = busy || resetting;
	const showButton = status !== "verified" && status !== "processing";
	const showReset = status !== "unstarted";
	const buttonLabel =
		status === "requires_input" || status === "canceled"
			? "Try again"
			: "Verify identity";
	const ResetIcon = status === "verified" ? Trash2 : RotateCcw;

	return (
		<AccountSection
			title="Identity verification"
			description="A one-time Stripe check. Verified document details are stored encrypted and used only for verification, booking prefill, and compliance workflows."
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
				{status === "verified" && identity.verifiedAt && (
					<span className="text-muted-foreground text-xs">
						on {formatDate(identity.verifiedAt)}
					</span>
				)}
			</div>

			<p className="text-muted-foreground text-sm leading-relaxed">
				{helperText(status)}
			</p>

			{error && <p className="text-destructive text-sm">{error}</p>}

			{status === "verified" && (
				<dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
					<ReadField
						label="Document type"
						value={valueOrFallback(identity.documentType)}
					/>
					<ReadField
						label="Issuing country"
						value={valueOrFallback(identity.issuingCountry)}
					/>
					<ReadField
						label="Nationality"
						value={valueOrFallback(identity.nationality)}
					/>
					<ReadField
						label="Document number"
						value={valueOrFallback(identity.maskedDocumentNumber)}
					/>
					<ReadField
						label="Expiry date"
						value={formatDate(identity.expiresOn)}
					/>
				</dl>
			)}

			{(showButton || showReset) && (
				<div className="flex flex-wrap items-center gap-2">
					{showButton && (
						<Button
							disabled={actionBusy || !configured}
							onClick={startVerification}
							size="sm"
							type="button"
							variant="outline"
						>
							{busy ? "Starting…" : buttonLabel}
						</Button>
					)}
					{showReset && (
						<Button
							disabled={actionBusy}
							onClick={resetVerification}
							size="xs"
							type="button"
							variant="destructive"
						>
							<ResetIcon aria-hidden="true" />
							{resetting ? "Resetting…" : resetButtonLabel(status)}
						</Button>
					)}
					{!configured && showButton && (
						<p className="basis-full text-muted-foreground text-xs">
							Verification is temporarily unavailable.
						</p>
					)}
				</div>
			)}
		</AccountSection>
	);
}
