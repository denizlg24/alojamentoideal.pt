"use client";

import { Input } from "@workspace/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useTransition } from "react";

const STATUS_OPTIONS = [
	{ label: "All statuses", value: "" },
	{ label: "Draft", value: "draft" },
	{ label: "Pending", value: "pending" },
	{ label: "Confirmed", value: "confirmed" },
	{ label: "Cancelled", value: "cancelled" },
	{ label: "Failed", value: "failed" },
] as const;

export function OrdersFilters() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [pending, startTransition] = useTransition();

	function apply(next: { q?: string; status?: string }) {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(next)) {
			if (value) {
				params.set(key, value);
			} else {
				params.delete(key);
			}
		}
		params.delete("page");
		startTransition(() => {
			router.replace(`${pathname}?${params.toString()}`);
		});
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		apply({ q: String(form.get("q") ?? "") });
	}

	return (
		<form
			key={searchParams.toString()}
			className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
			data-pending={pending || undefined}
			onSubmit={handleSubmit}
		>
			<Input
				className="w-full sm:w-64"
				defaultValue={searchParams.get("q") ?? ""}
				name="q"
				placeholder="Search reference, name or email"
				type="search"
			/>
			<NativeSelect
				aria-label="Filter by status"
				className="w-full sm:w-auto"
				defaultValue={searchParams.get("status") ?? ""}
				onChange={(event) => apply({ status: event.target.value })}
			>
				{STATUS_OPTIONS.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</form>
	);
}
