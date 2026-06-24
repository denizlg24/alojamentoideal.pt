"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { signIn } from "@/lib/auth/client";
import { claimCart } from "@/lib/checkout/api-client";
import type { AuthView } from "./auth-dialog-provider";

export function LoginForm({
	next,
	onSuccess,
	onSwitchView,
}: {
	next: string;
	/** Dialog mode: called after a successful sign-in instead of navigating to `next`. */
	onSuccess?: () => void;
	/** Dialog mode: switch the visible auth view in place instead of navigating. */
	onSwitchView?: (view: AuthView) => void;
}) {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const result = await signIn.email({ email: email.trim(), password });
			if (result.error) {
				setError(
					result.error.message ??
						"We could not sign you in. Check your details and try again.",
				);
				setSubmitting(false);
				return;
			}

			// The session.create hook already merges the anonymous cart; claimCart is
			// the idempotent backup path before returning to wherever they came from.
			try {
				await claimCart();
			} catch {
				// Non-fatal: the hook covers the common case.
			}

			if (onSuccess) {
				// Dialog mode: stay on the current page and let it react to the new
				// session (e.g. checkout re-claims the cart and prefills contact).
				onSuccess();
				return;
			}
			router.push(next);
			router.refresh();
		} catch (err) {
			console.error("LoginForm signIn error", err);
			setError("We could not sign you in. Check your details and try again.");
			setSubmitting(false);
		}
	};

	const handleGoogle = async () => {
		await signIn.social({ callbackURL: next, provider: "google" });
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="login-email">Email</Label>
				<Input
					autoComplete="email"
					id="login-email"
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="login-password">Password</Label>
				<Input
					autoComplete="current-password"
					id="login-password"
					onChange={(event) => setPassword(event.target.value)}
					required
					type="password"
					value={password}
				/>
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			<Button disabled={submitting} size="lg" type="submit">
				{submitting ? "Signing in" : "Log in"}
			</Button>

			{onSwitchView ? (
				<button
					className="text-center text-muted-foreground text-sm underline"
					onClick={() => onSwitchView("forgot")}
					type="button"
				>
					Forgot your password?
				</button>
			) : (
				<Link
					className="text-center text-muted-foreground text-sm underline"
					href="/forgot-password"
				>
					Forgot your password?
				</Link>
			)}

			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span className="h-px flex-1 bg-border" />
				or
				<span className="h-px flex-1 bg-border" />
			</div>
			<Button onClick={handleGoogle} size="lg" type="button" variant="outline">
				Continue with Google
				<FcGoogle />
			</Button>
		</form>
	);
}
