"use client";

import { Input } from "@workspace/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useTransition } from "react";

const SEVERITY_OPTIONS = [
	{ label: "Warning and above", value: "" },
	{ label: "Warning", value: "warning" },
	{ label: "Error", value: "error" },
	{ label: "Critical", value: "critical" },
] as const;

const TYPE_OPTIONS = [
	{ label: "All types", value: "" },
	{ label: "Request", value: "request" },
	{ label: "Error", value: "error" },
	{ label: "Rate limit", value: "rate_limit" },
	{ label: "Sync", value: "sync" },
	{ label: "Integration", value: "integration" },
	{ label: "Custom", value: "custom" },
] as const;

const WINDOW_OPTIONS = [
	{ label: "Last 24 hours", value: "24h" },
	{ label: "Last 7 days", value: "7d" },
	{ label: "Last 30 days", value: "30d" },
	{ label: "All time", value: "all" },
] as const;

export function ObservabilityFilters() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [pending, startTransition] = useTransition();

	function apply(next: Record<string, string>) {
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
			className="flex items-center gap-3"
			data-pending={pending || undefined}
			onSubmit={handleSubmit}
		>
			<Input
				className="w-56"
				defaultValue={searchParams.get("q") ?? ""}
				name="q"
				placeholder="Search name, route or provider"
				type="search"
			/>
			<NativeSelect
				aria-label="Filter by severity"
				defaultValue={searchParams.get("severity") ?? ""}
				onChange={(event) => apply({ severity: event.target.value })}
			>
				{SEVERITY_OPTIONS.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
			<NativeSelect
				aria-label="Filter by type"
				defaultValue={searchParams.get("type") ?? ""}
				onChange={(event) => apply({ type: event.target.value })}
			>
				{TYPE_OPTIONS.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
			<NativeSelect
				aria-label="Filter by time window"
				defaultValue={searchParams.get("window") ?? "7d"}
				onChange={(event) => apply({ window: event.target.value })}
			>
				{WINDOW_OPTIONS.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</form>
	);
}
