import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { StatusDot } from "@/components/status-dot";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SyncJobStatus } from "@/lib/sync/query";

// `provider_sync_state` uses "complete"; StatusDot keys on "completed".
function dotStatus(status: string): string {
	return status === "complete" ? "completed" : status;
}

function LastResult({ job }: { job: SyncJobStatus }) {
	const run = job.latestRun;
	if (!run) {
		return <span className="text-muted-foreground">No runs yet</span>;
	}
	return (
		<div className="flex flex-col gap-0.5">
			<span>
				{run.seen} seen · {run.updated} updated
				{run.failed > 0 ? (
					<span className="text-red-600 dark:text-red-400">
						{" "}
						· {run.failed} failed
					</span>
				) : null}
			</span>
			<span className="text-muted-foreground text-xs">
				{run.trigger} ·{" "}
				<time
					dateTime={(run.finishedAt ?? run.startedAt).toISOString()}
					title={formatDateTime(run.finishedAt ?? run.startedAt)}
				>
					{formatRelative(run.finishedAt ?? run.startedAt)}
				</time>
			</span>
		</div>
	);
}

export function SyncStatusTable({ jobs }: { jobs: SyncJobStatus[] }) {
	if (jobs.length === 0) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				No sync jobs have run yet. They register on their first scheduled run.
			</p>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Job</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Last completed</TableHead>
					<TableHead>Next run</TableHead>
					<TableHead>Last result</TableHead>
					<TableHead>Issue</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{jobs.map((job) => {
					const issue = job.error ?? job.latestRun?.error ?? null;
					return (
						<TableRow key={job.key}>
							<TableCell>
								<span className="font-medium">{job.label}</span>
								<span className="block text-muted-foreground text-xs">
									{job.provider} · {job.syncType}
								</span>
							</TableCell>
							<TableCell>
								<StatusDot status={dotStatus(job.status)} />
							</TableCell>
							<TableCell className="text-muted-foreground">
								{job.lastCompletedAt ? (
									<time
										dateTime={job.lastCompletedAt.toISOString()}
										title={formatDateTime(job.lastCompletedAt)}
									>
										{formatRelative(job.lastCompletedAt)}
									</time>
								) : (
									"—"
								)}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{job.isRunning ? (
									<span className="text-amber-600 dark:text-amber-400">
										running now
									</span>
								) : job.nextRunAt ? (
									<time
										dateTime={job.nextRunAt.toISOString()}
										title={formatDateTime(job.nextRunAt)}
									>
										{formatRelative(job.nextRunAt)}
									</time>
								) : (
									"—"
								)}
							</TableCell>
							<TableCell>
								<LastResult job={job} />
							</TableCell>
							<TableCell className="max-w-[16rem]">
								{issue ? (
									<span
										className="block truncate text-red-600 text-xs dark:text-red-400"
										title={issue}
									>
										{issue}
									</span>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
