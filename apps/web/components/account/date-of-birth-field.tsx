"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth/client";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
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

/**
 * Inline editable date of birth, rendered as a `<dt>`/`<dd>` pair so it sits in
 * the same description-list grid as the read-only name/email fields. The value
 * lives on the auth `user` record (a Better Auth additional field), so it is
 * saved through `authClient.updateUser` rather than the profile PUT route. The
 * displayed value updates optimistically and reconciles via `router.refresh()`.
 */
export function DateOfBirthField({
	initialDateOfBirth,
}: {
	initialDateOfBirth: string | null;
}) {
	const router = useRouter();
	const inputId = useId();
	const [value, setValue] = useState<string | null>(initialDateOfBirth);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(initialDateOfBirth ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function startEditing() {
		setDraft(value ?? "");
		setError(null);
		setEditing(true);
	}

	function cancel() {
		setEditing(false);
		setError(null);
	}

	async function save() {
		if (!ISO_DATE.test(draft)) {
			setError("Enter a valid date.");
			return;
		}
		if (draft > todayIso()) {
			setError("Your date of birth cannot be in the future.");
			return;
		}

		setSaving(true);
		setError(null);
		const previous = value;
		setValue(draft);

		const { error: updateError } = await authClient.updateUser({
			dateOfBirth: draft,
		});
		setSaving(false);

		if (updateError) {
			setValue(previous);
			setError("We could not save your date of birth. Please try again.");
			return;
		}

		setEditing(false);
		router.refresh();
	}

	return (
		<>
			<dt className="text-muted-foreground text-xs uppercase tracking-wide">
				Date of birth
			</dt>
			<dd className="mb-4 text-sm last:mb-0 sm:mb-0">
				{editing ? (
					<div className="flex flex-col gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<Label className="sr-only" htmlFor={inputId}>
								Date of birth
							</Label>
							<Input
								className="w-auto"
								disabled={saving}
								id={inputId}
								max={todayIso()}
								onChange={(event) => setDraft(event.target.value)}
								type="date"
								value={draft}
							/>
							<Button disabled={saving} onClick={save} size="sm" type="button">
								{saving ? "Saving…" : "Save"}
							</Button>
							<Button
								disabled={saving}
								onClick={cancel}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
						</div>
						{error && <p className="text-destructive text-xs">{error}</p>}
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<span>{formatDate(value)}</span>
						<Button
							className="h-auto p-0 text-sm underline"
							onClick={startEditing}
							type="button"
							variant="link"
						>
							{value ? "Edit" : "Add"}
						</Button>
					</div>
				)}
			</dd>
		</>
	);
}
