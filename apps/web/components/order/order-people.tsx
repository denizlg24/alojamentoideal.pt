"use client";

import type { OrderDetailMember } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { type FormEvent, useState } from "react";
import { toCheckoutError } from "@/lib/checkout/errors";
import * as orderApi from "@/lib/order/api-client";

function initial(email: string): string {
	return email.trim().charAt(0).toUpperCase() || "?";
}

function statusPresentation(member: OrderDetailMember): {
	className: string;
	label: string;
} {
	if (member.role === "owner") {
		return { className: "bg-foreground text-background", label: "Owner" };
	}
	switch (member.status) {
		case "active":
			return { className: "bg-emerald-100 text-emerald-800", label: "Joined" };
		case "revoked":
			return {
				className: "bg-muted text-muted-foreground",
				label: "No access",
			};
		default:
			return { className: "bg-amber-100 text-amber-800", label: "Invited" };
	}
}

export function OrderPeople({
	capacity,
	initialMembers,
	reference,
}: {
	capacity: number;
	initialMembers: OrderDetailMember[];
	reference: string;
}) {
	const [members, setMembers] = useState<OrderDetailMember[]>(initialMembers);
	const [email, setEmail] = useState("");
	const [inviting, setInviting] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// Anyone not revoked is holding a spot: the owner, joined members, and
	// still-pending invites all count against the guest capacity, so the owner
	// cannot invite more people than the booking has room for.
	const occupiedCount = members.filter(
		(member) => member.status !== "revoked",
	).length;
	const spotsFull = capacity > 0 && occupiedCount >= capacity;

	async function handleInvite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = email.trim();
		if (!trimmed || spotsFull) {
			return;
		}
		setInviting(true);
		setError(null);
		setNotice(null);
		try {
			const { member } = await orderApi.inviteOrderMember(reference, trimmed);
			setMembers((current) => {
				const withoutDuplicate = current.filter(
					(existing) => existing.id !== member.id,
				);
				return [
					...withoutDuplicate,
					{
						acceptedAt: null,
						email: member.email,
						id: member.id,
						invitedAt: new Date().toISOString(),
						isYou: false,
						role: "member",
						status: "invited",
					},
				];
			});
			setEmail("");
			setNotice(`Invite sent to ${member.email}.`);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setInviting(false);
		}
	}

	async function handleResend(member: OrderDetailMember) {
		setBusyId(member.id);
		setError(null);
		setNotice(null);
		try {
			await orderApi.resendOrderMemberInvite(reference, member.id);
			setMembers((current) =>
				current.map((existing) =>
					existing.id === member.id
						? { ...existing, acceptedAt: null, status: "invited" }
						: existing,
				),
			);
			setNotice(`Invite resent to ${member.email}.`);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusyId(null);
		}
	}

	async function handleRevoke(member: OrderDetailMember) {
		setBusyId(member.id);
		setError(null);
		setNotice(null);
		try {
			await orderApi.revokeOrderMember(reference, member.id);
			setMembers((current) =>
				current.map((existing) =>
					existing.id === member.id
						? { ...existing, acceptedAt: null, status: "revoked" }
						: existing,
				),
			);
			setNotice(`${member.email} no longer has access.`);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusyId(null);
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">People</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Invite the people joining you. Each person gets their own private link
					to add their guest details.
				</p>
				{capacity > 0 && (
					<p className="text-muted-foreground text-xs">
						{occupiedCount} of {capacity} spots used
					</p>
				)}
			</div>

			{spotsFull ? (
				<p className="text-muted-foreground text-xs">
					Every spot is filled. Remove a guest to free up a spot before sending
					another invite.
				</p>
			) : (
				<form
					className="flex flex-col gap-2 sm:flex-row"
					onSubmit={handleInvite}
				>
					<Input
						aria-label="Guest email"
						autoComplete="email"
						disabled={inviting}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="guest@email.com"
						type="email"
						value={email}
					/>
					<Button
						className="shrink-0"
						disabled={inviting || email.trim().length === 0}
						type="submit"
					>
						{inviting ? "Sending…" : "Send invite"}
					</Button>
				</form>
			)}
			{error && <p className="text-destructive text-sm">{error}</p>}
			{notice && <p className="text-emerald-700 text-sm">{notice}</p>}

			<ul className="flex flex-col divide-y divide-border/60">
				{members.map((member) => {
					const presentation = statusPresentation(member);
					const isBusy = busyId === member.id;
					const canManage = member.role !== "owner" && !member.isYou;
					const canResend =
						canManage &&
						(member.status === "invited" || member.status === "revoked");
					const canRevoke =
						canManage &&
						(member.status === "invited" || member.status === "active");
					return (
						<li className="flex items-center gap-3 py-3" key={member.id}>
							<span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-medium text-muted-foreground text-sm">
								{initial(member.email)}
							</span>
							<div className="flex min-w-0 flex-col">
								<span className="truncate font-medium text-sm">
									{member.email}
									{member.isYou && (
										<span className="text-muted-foreground"> (you)</span>
									)}
								</span>
								<span
									className={cn(
										"mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 font-medium text-xs",
										presentation.className,
									)}
								>
									{presentation.label}
								</span>
							</div>
							<div className="ml-auto flex shrink-0 items-center gap-1">
								{canResend && (
									<Button
										disabled={isBusy}
										onClick={() => handleResend(member)}
										size="sm"
										type="button"
										variant="ghost"
									>
										{isBusy ? "…" : "Resend"}
									</Button>
								)}
								{canRevoke && (
									<Button
										disabled={isBusy}
										onClick={() => handleRevoke(member)}
										size="sm"
										type="button"
										variant="ghost"
									>
										Remove
									</Button>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
