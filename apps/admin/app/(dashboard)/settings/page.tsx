import type { RuntimeSettings } from "@workspace/core/settings";
import {
	getRuntimeSettings,
	listHostkitListingCredentials,
	listListingPaymentDestinations,
	type RuntimeSettingDefinition,
	runtimeSettingDefinitions,
} from "@workspace/core/settings";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import type { Metadata } from "next";
import { getSyncOverview } from "@/lib/sync/query";
import {
	bumpManualSyncVersion,
	removeHostkitListingKey,
	saveHostkitListingKey,
	saveListingPaymentDestination,
	saveSettings,
} from "./actions";
import { SyncRefreshButton } from "./sync-refresh-button";
import { SyncStatusTable } from "./sync-status";

export const metadata: Metadata = { title: "Settings" };

interface SettingsPageProps {
	searchParams: Promise<{ error?: string; saved?: string }>;
}

const SETTING_GROUPS = [
	"communications",
	"features",
	"hostify",
	"bokun",
	"payments",
	"hostkit",
] as const;

const GROUP_LABELS = {
	bokun: "Bokun activities",
	communications: "Communications",
	features: "Enabled features",
	hostify: "Hostify sync",
	hostkit: "Hostkit",
	payments: "Payments",
} as const;

function SettingField({
	definition,
	value,
}: {
	definition: RuntimeSettingDefinition;
	value: RuntimeSettings[keyof RuntimeSettings];
}) {
	return (
		<div className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] md:items-center">
			<div>
				<Label className="font-medium text-sm" htmlFor={definition.key}>
					{definition.label}
				</Label>
				<p className="mt-1 text-muted-foreground text-xs">
					{definition.description}
				</p>
			</div>
			{definition.type === "boolean" ? (
				<label className="flex items-center justify-start gap-2 text-sm md:justify-end">
					<input
						className="size-4 accent-foreground"
						defaultChecked={value === true}
						id={definition.key}
						name={definition.key}
						type="checkbox"
					/>
					<span className="text-muted-foreground">Enabled</span>
				</label>
			) : (
				<Input
					defaultValue={String(value ?? "")}
					id={definition.key}
					max={"max" in definition ? definition.max : undefined}
					min={"min" in definition ? definition.min : undefined}
					name={definition.key}
					type={definition.type === "integer" ? "number" : "text"}
				/>
			)}
		</div>
	);
}

export default async function SettingsPage({
	searchParams,
}: SettingsPageProps) {
	const [params, settings, hostkitListings, paymentListings, syncJobs] =
		await Promise.all([
			searchParams,
			getRuntimeSettings(),
			listHostkitListingCredentials(),
			listListingPaymentDestinations(),
			getSyncOverview(),
		]);
	const error = params.error;
	const saved = params.saved;
	const savedMessage =
		saved === "sync" ? "Manual resync requested." : "Changes saved.";

	const runningJobs = syncJobs.filter((job) => job.isRunning).length;
	const issueJobs = syncJobs.filter(
		(job) =>
			job.status === "failed" ||
			job.error !== null ||
			(job.latestRun?.failed ?? 0) > 0,
	).length;
	const syncSummary =
		syncJobs.length === 0
			? "No jobs registered yet"
			: [
					`${syncJobs.length} jobs`,
					runningJobs > 0 ? `${runningJobs} running` : null,
					issueJobs > 0 ? `${issueJobs} with issues` : "all healthy",
				]
					.filter(Boolean)
					.join(" · ");

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Settings
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Runtime controls for sync jobs, feature gates and property
						integrations.
					</p>
				</div>
				{error ? (
					<p className="text-red-600 text-sm dark:text-red-400">{error}</p>
				) : saved ? (
					<p className="text-emerald-600 text-sm dark:text-emerald-400">
						{savedMessage}
					</p>
				) : null}
			</div>

			<Accordion
				className="mt-8"
				defaultValue={["sync-status"]}
				type="multiple"
			>
				<AccordionItem value="sync-status">
					<AccordionTrigger>
						<span className="flex flex-col gap-0.5">
							<span className="font-medium text-sm">Sync status</span>
							<span className="font-normal text-muted-foreground text-xs">
								{syncSummary}
							</span>
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="mb-2 flex justify-end">
							<SyncRefreshButton />
						</div>
						<SyncStatusTable jobs={syncJobs} />
					</AccordionContent>
				</AccordionItem>

				<AccordionItem value="manual-resync">
					<AccordionTrigger>
						<span className="flex flex-col gap-0.5">
							<span className="font-medium text-sm">Manual resync</span>
							<span className="font-normal text-muted-foreground text-xs">
								Listings v{settings["hostify.listingSyncVersion"]} · Activities
								v{settings["bokun.activitySyncVersion"]}
							</span>
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
							<p className="text-muted-foreground text-sm">
								Bump the listing and activity sync versions so the next sync
								refreshes cached Homes and Activities.
							</p>
							<form action={bumpManualSyncVersion}>
								<Button type="submit" variant="secondary">
									Manual resync
								</Button>
							</form>
						</div>
					</AccordionContent>
				</AccordionItem>

				{SETTING_GROUPS.map((group) => (
					<AccordionItem key={group} value={group}>
						<AccordionTrigger>
							<span className="font-medium text-sm">{GROUP_LABELS[group]}</span>
						</AccordionTrigger>
						<AccordionContent>
							<form action={saveSettings}>
								<input name="__group" type="hidden" value={group} />
								<div className="divide-y divide-border/60">
									{runtimeSettingDefinitions
										.filter((definition) => definition.group === group)
										.map((definition) => (
											<SettingField
												definition={definition}
												key={definition.key}
												value={settings[definition.key]}
											/>
										))}
								</div>
								<div className="mt-4 flex justify-end">
									<Button type="submit">Save {GROUP_LABELS[group]}</Button>
								</div>
							</form>
						</AccordionContent>
					</AccordionItem>
				))}

				<AccordionItem value="hostkit-keys">
					<AccordionTrigger>
						<span className="flex flex-col gap-0.5">
							<span className="font-medium text-sm">Hostkit property keys</span>
							<span className="font-normal text-muted-foreground text-xs">
								Keys are encrypted per listing. Saved keys are never shown
								again.
							</span>
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="divide-y divide-border/60 border-border/60 border-t border-b">
							{hostkitListings.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground text-sm">
									No active Hostify listings have been synced yet.
								</p>
							) : (
								hostkitListings.map((listing) => (
									<div
										className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)_auto]"
										key={listing.listingExternalId}
									>
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{listing.listingName ?? "Untitled listing"}
											</p>
											<p className="mt-1 text-muted-foreground text-xs">
												Hostify {listing.listingExternalId}
												{listing.hasApiKey
													? ` · key ${listing.keyHint ?? "saved"}`
													: " · no key"}
											</p>
										</div>
										<form action={saveHostkitListingKey} className="flex gap-2">
											<input
												name="listingExternalId"
												type="hidden"
												value={listing.listingExternalId}
											/>
											<Input
												aria-label={`Hostkit API key for ${listing.listingName ?? listing.listingExternalId}`}
												name="apiKey"
												placeholder={
													listing.hasApiKey
														? "Replace encrypted key"
														: "Paste API key"
												}
												type="password"
											/>
											<Button type="submit" variant="secondary">
												Save
											</Button>
										</form>
										<form action={removeHostkitListingKey}>
											<input
												name="listingExternalId"
												type="hidden"
												value={listing.listingExternalId}
											/>
											<Button
												disabled={!listing.hasApiKey}
												type="submit"
												variant="ghost"
											>
												Remove
											</Button>
										</form>
									</div>
								))
							)}
						</div>
					</AccordionContent>
				</AccordionItem>

				<AccordionItem value="listing-payments">
					<AccordionTrigger>
						<span className="flex flex-col gap-0.5">
							<span className="font-medium text-sm">
								Listing payment destinations
							</span>
							<span className="font-normal text-muted-foreground text-xs">
								Optional Stripe connected account for each home's gross booking
								funds.
							</span>
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="divide-y divide-border/60 border-border/60 border-t border-b">
							{paymentListings.map((listing) => (
								<form
									action={saveListingPaymentDestination}
									className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)_auto] lg:items-center"
									key={listing.id}
								>
									<input name="listingId" type="hidden" value={listing.id} />
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">
											{listing.listingName ?? "Untitled listing"}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											Hostify {listing.listingExternalId}
										</p>
									</div>
									<Input
										aria-label={`Stripe connected account for ${listing.listingName ?? listing.listingExternalId}`}
										defaultValue={listing.stripeConnectedAccountId ?? ""}
										name="stripeConnectedAccountId"
										placeholder="acct_... (leave blank for platform)"
									/>
									<Button type="submit" variant="secondary">
										Save
									</Button>
								</form>
							))}
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}
