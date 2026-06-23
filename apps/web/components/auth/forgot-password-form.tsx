"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import type { AuthView } from "./auth-dialog-provider";

export function ForgotPasswordForm({
	onSwitchView,
}: {
	/** Dialog mode: switch the visible auth view in place instead of navigating. */
	onSwitchView?: (view: AuthView) => void;
}) {
	const [email, setEmail] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [sent, setSent] = useState(false);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		// Always resolve to the same neutral state so we never reveal whether an
		// account exists for the address.
		try {
			await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: "/reset-password",
			});
		} catch {
			// Ignore: the response must not depend on whether the email exists.
		}
		setSubmitting(false);
		setSent(true);
	};

	if (sent) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-sm">
					If an account exists for that email, we've sent a link to reset your
					password.
				</p>
				{onSwitchView ? (
					<Button onClick={() => onSwitchView("login")} variant="outline">
						Back to log in
					</Button>
				) : (
					<Button asChild variant="outline">
						<Link href="/login">Back to log in</Link>
					</Button>
				)}
			</div>
		);
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="forgot-email">Email</Label>
				<Input
					autoComplete="email"
					id="forgot-email"
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</div>
			<Button disabled={submitting} size="lg" type="submit">
				{submitting ? "Sending" : "Send reset link"}
			</Button>
			{onSwitchView ? (
				<button
					className="text-center text-muted-foreground text-sm underline"
					onClick={() => onSwitchView("login")}
					type="button"
				>
					Back to log in
				</button>
			) : (
				<Link
					className="text-center text-muted-foreground text-sm underline"
					href="/login"
				>
					Back to log in
				</Link>
			)}
		</form>
	);
}
