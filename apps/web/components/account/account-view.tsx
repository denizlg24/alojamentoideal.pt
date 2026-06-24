import type { AccountProfile } from "@workspace/core/account";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { AccountSection, ReadField } from "./account-ui";
import { IdentityVerification } from "./identity-verification";
import { ProfileForm } from "./profile-form";

export interface AccountUser {
	name: string;
	email: string;
	image: string | null;
	dateOfBirth: string | null;
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	const first = parts[0]?.[0] ?? "";
	const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
	return (first + last).toUpperCase();
}

function formatDate(value: string | null): string {
	if (!value) {
		return "Not set";
	}
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	const date = dateOnly
		? new Date(
				Number(dateOnly[1]),
				Number(dateOnly[2]) - 1,
				Number(dateOnly[3]),
			)
		: new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleDateString("en", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

export function AccountView({
	user,
	profile,
}: {
	user: AccountUser;
	profile: AccountProfile;
}) {
	const firstName = user.name?.split(" ")[0] || "there";

	return (
		<>
			<header className="pb-2">
				<h1 className="font-heading font-semibold text-3xl">Hi {firstName}</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Manage your details and how we reach you about your stays.
				</p>
			</header>

			<AccountSection
				title="Profile"
				description="Your name and the email you sign in with."
			>
				<div className="flex items-center gap-4">
					<Avatar className="size-16">
						{user.image && <AvatarImage alt={user.name} src={user.image} />}
						<AvatarFallback>{initials(user.name)}</AvatarFallback>
					</Avatar>
					<div className="flex flex-col items-start gap-1">
						<Button disabled size="sm" type="button" variant="outline">
							Upload photo
						</Button>
						<span className="text-muted-foreground text-xs">
							Photo uploads are coming soon.
						</span>
					</div>
				</div>

				<dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
					<ReadField label="Name" value={user.name || "Not set"} />
					<ReadField label="Email" value={user.email} />
					<ReadField
						label="Date of birth"
						value={formatDate(user.dateOfBirth)}
					/>
				</dl>
			</AccountSection>

			<ProfileForm initialProfile={profile} />

			<IdentityVerification initialIdentity={profile.identity} />
		</>
	);
}
