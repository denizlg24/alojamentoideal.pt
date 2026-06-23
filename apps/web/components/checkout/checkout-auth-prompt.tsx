"use client";

import { Button } from "@workspace/ui/components/button";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";

interface CheckoutAuthPromptProps {
	next: string;
}

/**
 * Optional sign-in nudge on the contact step. Logging in links this booking to
 * the guest's account (their in-progress cart is claimed on sign-in) and lets
 * their saved details prefill. Checkout stays fully available without an account.
 * Opens the auth overlay in place so the guest never leaves their booking.
 */
export function CheckoutAuthPrompt({ next }: CheckoutAuthPromptProps) {
	const { openAuth } = useAuthDialog();
	return (
		<div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-muted-foreground text-sm">
				Have an account? Log in to save this booking to your account and reuse
				your details.
			</p>
			<div className="flex shrink-0 gap-2">
				<Button
					onClick={() => openAuth({ next, view: "login" })}
					size="sm"
					variant="outline"
				>
					Log in
				</Button>
				<Button
					onClick={() => openAuth({ next, view: "register" })}
					size="sm"
					variant="ghost"
				>
					Register
				</Button>
			</div>
		</div>
	);
}
