"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Re-fetches the server component so a running sync's progress can be checked. */
export function SyncRefreshButton() {
	const router = useRouter();
	const [pending, startTransition] = useTransition();

	return (
		<Button
			className="gap-1.5 text-muted-foreground text-xs"
			disabled={pending}
			onClick={() => startTransition(() => router.refresh())}
			size="sm"
			type="button"
			variant="ghost"
		>
			<RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
			{pending ? "Refreshing" : "Refresh"}
		</Button>
	);
}
