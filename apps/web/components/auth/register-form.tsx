"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import Link from "next/link";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth/client";
import type { AuthView } from "./auth-dialog-provider";

const MIN_PASSWORD_LENGTH = 8;

export function RegisterForm({
	next,
	onSwitchView,
}: {
	next: string;
	/** Dialog mode: switch the visible auth view in place instead of navigating. */
	onSwitchView?: (view: AuthView) => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [dateOfBirth, setDateOfBirth] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);

		if (password.length < MIN_PASSWORD_LENGTH) {
			setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}
		if (password !== confirm) {
			setError("Those passwords do not match.");
			return;
		}
		if (!dateOfBirth) {
			setError("Please enter your date of birth.");
			return;
		}

		setSubmitting(true);
		const result = await signUp.email({
			// `callbackURL` is where the verification link lands after the email is
			// confirmed. Pointing it at `next` returns mid-booking sign-ups straight
			// back to their checkout once verified (auto sign-in claims the cart).
			callbackURL: next,
			dateOfBirth,
			email: email.trim(),
			name: name.trim(),
			password,
		});
		setSubmitting(false);

		if (result.error) {
			setError(
				result.error.message ??
					"We could not create your account. Please try again.",
			);
			return;
		}

		// Sign-up does not create a session (email verification is required). Show
		// the verify-email state; the cart merges automatically on first login.
		setVerifyEmail(email.trim());
	};

	const handleGoogle = async () => {
		await signIn.social({ callbackURL: next, provider: "google" });
	};

	if (verifyEmail) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-sm">
					We sent a verification link to{" "}
					<span className="font-medium">{verifyEmail}</span>. Open it to
					activate your account.
				</p>
				<p className="text-muted-foreground text-sm">
					You can keep your booking going as a guest in the meantime; signing in
					later links it to your account.
				</p>
				{onSwitchView ? (
					<Button onClick={() => onSwitchView("login")} variant="outline">
						Back to log in
					</Button>
				) : (
					<Button asChild variant="outline">
						<Link href={`/login?next=${encodeURIComponent(next)}`}>
							Back to log in
						</Link>
					</Button>
				)}
			</div>
		);
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="register-name">Full name</Label>
				<Input
					autoComplete="name"
					id="register-name"
					onChange={(event) => setName(event.target.value)}
					required
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="register-email">Email</Label>
				<Input
					autoComplete="email"
					id="register-email"
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="register-dob">Date of birth</Label>
				<Input
					autoComplete="bday"
					id="register-dob"
					onChange={(event) => setDateOfBirth(event.target.value)}
					required
					type="date"
					value={dateOfBirth}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="register-password">Password</Label>
				<Input
					autoComplete="new-password"
					id="register-password"
					minLength={MIN_PASSWORD_LENGTH}
					onChange={(event) => setPassword(event.target.value)}
					required
					type="password"
					value={password}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="register-confirm">Confirm password</Label>
				<Input
					autoComplete="new-password"
					id="register-confirm"
					onChange={(event) => setConfirm(event.target.value)}
					required
					type="password"
					value={confirm}
				/>
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			<Button disabled={submitting} size="lg" type="submit">
				{submitting ? "Creating account" : "Create account"}
			</Button>

			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span className="h-px flex-1 bg-border" />
				or
				<span className="h-px flex-1 bg-border" />
			</div>
			<Button onClick={handleGoogle} size="lg" type="button" variant="outline">
				Continue with Google
			</Button>
		</form>
	);
}
