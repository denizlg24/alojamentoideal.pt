import { Button } from "@workspace/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import {
	isEventSeverity,
	isEventType,
	isEventWindow,
	listObservabilityEvents,
} from "@/lib/observability/query";
import { ObservabilityFilters } from "./observability-filters";

export const metadata: Metadata = { title: "Observability" };

interface ObservabilityPageProps {
	searchParams: Promise<{
		page?: string;
		q?: string;
		severity?: string;
		type?: string;
		window?: string;
	}>;
}

const SEVERITY_TEXT: Record<string, string> = {
	critical: "text-red-600 dark:text-red-400",
	debug: "text-muted-foreground",
	error: "text-red-600 dark:text-red-400",
	info: "text-sky-600 dark:text-sky-400",
	warning: "text-amber-600 dark:text-amber-500",
};

function pageHref(params: Record<string, string | null>, page: number): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			search.set(key, value);
		}
	}
	if (page > 0) {
		search.set("page", String(page));
	}
	const query = search.toString();
	return query ? `/observability?${query}` : "/observability";
}

export default async function ObservabilityPage({
	searchParams,
}: ObservabilityPageProps) {
	const params = await searchParams;
	const severity =
		params.severity && isEventSeverity(params.severity)
			? params.severity
			: null;
	const type = params.type && isEventType(params.type) ? params.type : null;
	const rawWindow = params.window ?? "7d";
	const window = isEventWindow(rawWindow) ? rawWindow : null;
	const query = params.q?.trim() || null;
	const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

	const { hasNext, rows } = await listObservabilityEvents({
		page,
		query,
		severity,
		type,
		window,
	});

	const hrefParams = {
		q: query,
		severity,
		type,
		window: params.window ?? null,
	};

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex items-end justify-between gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Observability
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Events recorded across the platform, from debug traces to critical
						failures.
					</p>
				</div>
				<ObservabilityFilters />
			</div>

			<div className="mt-6 divide-y divide-border/60 border-border/60 border-t border-b">
				{rows.length === 0 ? (
					<p className="py-10 text-center text-muted-foreground text-sm">
						No events match these filters.
					</p>
				) : (
					rows.map((event) => (
						<details className="group py-2.5" key={event.id}>
							<summary className="flex cursor-pointer list-none items-baseline gap-3 text-sm [&::-webkit-details-marker]:hidden">
								<span className="w-36 shrink-0 text-muted-foreground text-xs tabular-nums">
									{formatDateTime(event.occurredAt)}
								</span>
								<span
									className={`w-16 shrink-0 font-medium text-xs uppercase tracking-wide ${SEVERITY_TEXT[event.severity] ?? "text-muted-foreground"}`}
								>
									{event.severity}
								</span>
								<span className="min-w-0 flex-1 truncate">
									{event.name}
									{event.route ? (
										<span className="text-muted-foreground">
											{" "}
											· {event.method ?? ""} {event.route}
										</span>
									) : null}
								</span>
								{event.statusCode ? (
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{event.statusCode}
									</span>
								) : null}
								<span className="shrink-0 text-muted-foreground text-xs">
									{event.type}
								</span>
							</summary>
							<dl className="mt-2 ml-39 grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground text-xs">
								{event.provider ? <div>provider: {event.provider}</div> : null}
								{event.requestId ? <div>request: {event.requestId}</div> : null}
								{event.durationMs !== null ? (
									<div>duration: {event.durationMs}ms</div>
								) : null}
								{event.metadata ? (
									<pre className="col-span-2 mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-xs">
										{JSON.stringify(event.metadata, null, 2)}
									</pre>
								) : null}
							</dl>
						</details>
					))
				)}
			</div>

			<div className="mt-4 flex items-center justify-end gap-2">
				<Button asChild size="sm" variant="ghost">
					<Link
						aria-disabled={page === 0}
						className={page === 0 ? "pointer-events-none opacity-40" : ""}
						href={pageHref(hrefParams, page - 1)}
					>
						Previous
					</Link>
				</Button>
				<Button asChild size="sm" variant="ghost">
					<Link
						aria-disabled={!hasNext}
						className={hasNext ? "" : "pointer-events-none opacity-40"}
						href={pageHref(hrefParams, page + 1)}
					>
						Next
					</Link>
				</Button>
			</div>
		</div>
	);
}
