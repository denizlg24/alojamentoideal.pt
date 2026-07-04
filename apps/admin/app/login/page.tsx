import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

interface LoginPageProps {
	searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
	if (user?.role === "admin") {
		redirect("/");
	}

	return (
		<main className="flex min-h-svh items-center justify-center px-6">
			<div className="w-full max-w-xs">
				<h1 className="font-display text-lg font-semibold tracking-tight">
					Alojamento Ideal
				</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Operations dashboard sign in
				</p>
				<LoginForm forbidden={params.error === "forbidden"} />
			</div>
		</main>
	);
}
