"use client";

import { Button } from "@workspace/ui/components/button";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
	const router = useRouter();
	const [pending, startTransition] = useTransition();

	return (
		<Button
			className="text-muted-foreground"
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
			Sign out
		</Button>
	);
}
