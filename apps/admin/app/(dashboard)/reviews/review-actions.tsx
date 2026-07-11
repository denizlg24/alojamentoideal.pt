"use client";

import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** Publish/hide controls for one review row; refreshes the table on success. */
export function ReviewActions({ id, status }: { id: string; status: string }) {
	const router = useRouter();
	const [pending, setPending] = useState(false);

	const setStatus = async (nextStatus: "hidden" | "published") => {
		setPending(true);
		try {
			const response = await fetch(
				`/api/admin/reviews/${encodeURIComponent(id)}`,
				{
					body: JSON.stringify({ status: nextStatus }),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			);
			if (!response.ok) {
				throw new Error(`Failed with ${response.status}`);
			}
			toast.success(
				nextStatus === "published" ? "Review published" : "Review hidden",
			);
			router.refresh();
		} catch {
			toast.error("Could not update the review. Try again.");
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="flex justify-end gap-2">
			{status !== "published" && (
				<Button
					disabled={pending}
					onClick={() => setStatus("published")}
					size="sm"
					variant="outline"
				>
					Publish
				</Button>
			)}
			{status !== "hidden" && (
				<Button
					disabled={pending}
					onClick={() => setStatus("hidden")}
					size="sm"
					variant="ghost"
				>
					Hide
				</Button>
			)}
		</div>
	);
}
