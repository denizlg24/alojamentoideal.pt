"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { TableCell } from "@workspace/ui/components/table";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/status-dot";
import { admin } from "@/lib/auth/client";

interface UserRowControlsProps {
	banned: boolean;
	email: string;
	isSelf: boolean;
	role: string;
	userId: string;
}

type PendingAction = "ban" | "unban" | "promote" | "demote";

const ACTION_LABELS: Record<PendingAction, string> = {
	ban: "Ban user",
	demote: "Remove admin role",
	promote: "Make admin",
	unban: "Lift ban",
};

const ACTION_DESCRIPTIONS: Record<PendingAction, string> = {
	ban: "The user can no longer sign in; their sessions are revoked.",
	demote: "The user loses access to this dashboard.",
	promote: "The user gains the admin role and full access to this dashboard.",
	unban: "The user can sign in again.",
};

/**
 * Role, account status and the role/ban menu for one user row. Both fields
 * render optimistically and settle on the server truth after the refresh.
 * Self-service is disabled: an admin cannot demote or ban themselves.
 */
export function UserRowControls({
	banned,
	email,
	isSelf,
	role,
	userId,
}: UserRowControlsProps) {
	const router = useRouter();
	const [confirming, setConfirming] = useState<PendingAction | null>(null);
	const [pending, startTransition] = useTransition();
	const [optimistic, setOptimistic] = useOptimistic({ banned, role });

	function run(action: PendingAction) {
		startTransition(async () => {
			setOptimistic({
				banned: action === "ban" ? true : action === "unban" ? false : banned,
				role:
					action === "promote" ? "admin" : action === "demote" ? "user" : role,
			});
			const result =
				action === "ban"
					? await admin.banUser({ userId })
					: action === "unban"
						? await admin.unbanUser({ userId })
						: await admin.setRole({
								role: action === "promote" ? "admin" : "user",
								userId,
							});
			if (result.error) {
				toast.error(result.error.message ?? "Action failed.");
			} else {
				toast.success(`${ACTION_LABELS[action]}: done for ${email}.`);
			}
			router.refresh();
		});
	}

	return (
		<>
			<TableCell
				className={
					optimistic.role === "admin" ? "font-medium" : "text-muted-foreground"
				}
			>
				{optimistic.role || "user"}
			</TableCell>
			<TableCell>
				<StatusDot status={optimistic.banned ? "failed" : "active"} />
				<span className="sr-only">
					{optimistic.banned ? "banned" : "active"}
				</span>
			</TableCell>
			<TableCell className="text-right">
				{isSelf ? null : (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label={`Actions for ${email}`}
								disabled={pending}
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{optimistic.role === "admin" ? (
								<DropdownMenuItem onSelect={() => setConfirming("demote")}>
									Remove admin role
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem onSelect={() => setConfirming("promote")}>
									Make admin
								</DropdownMenuItem>
							)}
							{optimistic.banned ? (
								<DropdownMenuItem onSelect={() => setConfirming("unban")}>
									Lift ban
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									onSelect={() => setConfirming("ban")}
									variant="destructive"
								>
									Ban user
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<AlertDialog
					onOpenChange={(open) => {
						if (!open) {
							setConfirming(null);
						}
					}}
					open={confirming !== null}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{confirming ? ACTION_LABELS[confirming] : ""}?
							</AlertDialogTitle>
							<AlertDialogDescription>
								{email}. {confirming ? ACTION_DESCRIPTIONS[confirming] : ""}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Keep as is</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									if (confirming) {
										run(confirming);
									}
								}}
							>
								Confirm
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</TableCell>
		</>
	);
}
