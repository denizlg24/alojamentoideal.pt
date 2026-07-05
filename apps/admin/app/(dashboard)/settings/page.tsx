import {
	getRuntimeSettings,
	listHostkitListingCredentials,
	runtimeSettingDefinitions,
} from "@workspace/core/settings";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import type { Metadata } from "next";
import {
	removeHostkitListingKey,
	saveHostkitListingKey,
	saveSettings,
} from "./actions";

export const metadata: Metadata = { title: "Settings" };

interface SettingsPageProps {
	searchParams: Promise<{ saved?: string }>;
}

const GROUP_LABELS = {
	features: "Enabled features",
	hostify: "Hostify sync",
	hostkit: "Hostkit",
} as const;

export default async function SettingsPage({
	searchParams,
}: SettingsPageProps) {
	const [params, settings, hostkitListings] = await Promise.all([
		searchParams,
		getRuntimeSettings(),
		listHostkitListingCredentials(),
	]);
	const saved = params.saved;

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex items-end justify-between gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Settings
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Runtime controls for sync jobs, feature gates and property
						integrations.
					</p>
				</div>
				{saved ? (
					<p className="text-emerald-600 text-sm dark:text-emerald-400">
						Changes saved.
					</p>
				) : null}
			</div>

			<form action={saveSettings} className="mt-8">
				<div className="space-y-10">
					{(["features", "hostify", "hostkit"] as const).map((group) => (
						<section
							aria-labelledby={`${group}-settings-heading`}
							className="border-border/60 border-t pt-5"
							key={group}
						>
							<div className="mb-4">
								<h2
									className="font-display font-semibold text-base tracking-tight"
									id={`${group}-settings-heading`}
								>
									{GROUP_LABELS[group]}
								</h2>
							</div>
							<div className="divide-y divide-border/60">
								{runtimeSettingDefinitions
									.filter((definition) => definition.group === group)
									.map((definition) => (
										<div
											className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] md:items-center"
											key={definition.key}
										>
											<div>
												<Label
													className="font-medium text-sm"
													htmlFor={definition.key}
												>
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
														defaultChecked={settings[definition.key] === true}
														id={definition.key}
														name={definition.key}
														type="checkbox"
													/>
													<span className="text-muted-foreground">Enabled</span>
												</label>
											) : (
												<Input
													defaultValue={String(settings[definition.key] ?? "")}
													id={definition.key}
													max={"max" in definition ? definition.max : undefined}
													min={"min" in definition ? definition.min : undefined}
													name={definition.key}
													type={
														definition.type === "integer" ? "number" : "text"
													}
												/>
											)}
										</div>
									))}
							</div>
						</section>
					))}
				</div>
				<div className="mt-6 flex justify-end">
					<Button type="submit">Save settings</Button>
				</div>
			</form>

			<section
				aria-labelledby="hostkit-keys-heading"
				className="mt-10 border-border/60 border-t pt-5"
			>
				<h2
					className="font-display font-semibold text-base tracking-tight"
					id="hostkit-keys-heading"
				>
					Hostkit property keys
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Keys are encrypted per listing. Saved keys are never shown again.
				</p>
				<div className="mt-4 divide-y divide-border/60 border-border/60 border-t border-b">
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
			</section>
		</div>
	);
}
