"use client";

import { Input } from "@workspace/ui/components/input";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useTransition } from "react";

export function UsersFilters() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [pending, startTransition] = useTransition();

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const params = new URLSearchParams(searchParams);
		const q = String(form.get("q") ?? "").trim();
		if (q) {
			params.set("q", q);
		} else {
			params.delete("q");
		}
		params.delete("page");
		startTransition(() => {
			router.replace(`${pathname}?${params.toString()}`);
		});
	}

	return (
		<form data-pending={pending || undefined} onSubmit={handleSubmit}>
			<Input
				className="w-64"
				defaultValue={searchParams.get("q") ?? ""}
				name="q"
				placeholder="Search by email"
				type="search"
			/>
		</form>
	);
}
