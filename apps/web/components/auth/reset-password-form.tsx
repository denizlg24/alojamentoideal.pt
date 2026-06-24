"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm({ token }: { token: string | null }) {
	const router = useRouter();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [done, setDone] = useState(false);

	if (!token) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-sm">
					This reset link is invalid or has expired. Request a new one to
					continue.
				</p>
				<Button asChild variant="outline">
					<Link href="/forgot-password">Request a new link</Link>
				</Button>
			</div>
		);
	}

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
		try {
			setSubmitting(true);
			const result = await authClient.resetPassword({
				newPassword: password,
				token,
			});
			setSubmitting(false);

			if (result.error) {
				setError(
					result.error.message ??
						"We could not reset your password. The link may have expired.",
				);
				return;
			}
			setDone(true);
		} catch (error) {
			setSubmitting(false);
			setError(
				error instanceof Error
					? error.message
					: "We could not reset your password. The link may have expired.",
			);
		}
	};

	if (done) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-sm">Your password has been reset.</p>
				<Button onClick={() => router.push("/login")}>
					Continue to log in
				</Button>
			</div>
		);
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="reset-password">New password</Label>
				<Input
					autoComplete="new-password"
					id="reset-password"
					minLength={MIN_PASSWORD_LENGTH}
					onChange={(event) => setPassword(event.target.value)}
					required
					type="password"
					value={password}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="reset-confirm">Confirm new password</Label>
				<Input
					autoComplete="new-password"
					id="reset-confirm"
					onChange={(event) => setConfirm(event.target.value)}
					required
					type="password"
					value={confirm}
				/>
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			<Button disabled={submitting} size="lg" type="submit">
				{submitting ? "Saving" : "Reset password"}
			</Button>
		</form>
	);
}
