"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { signIn } from "@/lib/auth/client";

interface LoginFormProps {
	forbidden: boolean;
}

export function LoginForm({ forbidden }: LoginFormProps) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(
		forbidden ? "This account does not have admin access." : null,
	);
	const [pending, startTransition] = useTransition();

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "");
		const password = String(form.get("password") ?? "");

		startTransition(async () => {
			try {
				const result = await signIn.email({ email, password });
				if (result.error) {
					setError(result.error.message ?? "Sign in failed.");
					return;
				}
				router.replace("/");
				router.refresh();
			} catch {
				setError("Sign in failed. Please try again.");
			}
		});
	}

	return (
		<form className="mt-8 space-y-5" onSubmit={handleSubmit}>
			<div className="space-y-2">
				<Label htmlFor="email">Email</Label>
				<Input
					autoComplete="email"
					autoFocus
					id="email"
					name="email"
					required
					type="email"
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="password">Password</Label>
				<Input
					autoComplete="current-password"
					id="password"
					name="password"
					required
					type="password"
				/>
			</div>
			{error ? <p className="text-destructive text-sm">{error}</p> : null}
			<Button className="w-full" disabled={pending} type="submit">
				{pending ? "Signing in…" : "Sign in"}
			</Button>
		</form>
	);
}
