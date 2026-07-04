"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "@/lib/auth/client";

export function SignOutButton({ className }: { className?: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();

	return (
		<Button
			className={cn("text-muted-foreground", className)}
			disabled={pending}
			onClick={() =>
				startTransition(async () => {
					await signOut();
					router.replace("/login");
					router.refresh();
				})
			}
			size="sm"
			variant="ghost"
		>
			<LogOut aria-hidden data-slot="icon" />
			<span>Sign out</span>
		</Button>
	);
}
