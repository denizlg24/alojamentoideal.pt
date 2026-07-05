import type { ActivityDetail } from "@workspace/core/activities";
import { difficultyLabel } from "@workspace/core/activities";
import { Badge } from "@workspace/ui/components/badge";
import type { LucideIcon } from "lucide-react";
import { Clock, Gauge, Languages, MapPin, Users } from "lucide-react";
import {
	formatDuration,
	formatLanguage,
	formatMeetingType,
} from "@/lib/activities/format";

interface Fact {
	icon: LucideIcon;
	label: string;
	value: string;
}

function collectFacts(activity: ActivityDetail): Fact[] {
	const facts: Fact[] = [];
	const duration = formatDuration(activity.duration);
	if (duration) facts.push({ icon: Clock, label: "Duration", value: duration });
	if (activity.difficulty) {
		facts.push({
			icon: Gauge,
			label: "Difficulty",
			value: difficultyLabel(activity.difficulty),
		});
	}
	if (activity.languages.length > 0) {
		facts.push({
			icon: Languages,
			label: "Languages",
			value: activity.languages.map(formatLanguage).join(", "),
		});
	}
	const meeting = formatMeetingType(activity.meetingType);
	if (meeting) facts.push({ icon: MapPin, label: "Meeting", value: meeting });
	if (activity.minAge !== null && activity.minAge > 0) {
		facts.push({
			icon: Users,
			label: "Minimum age",
			value: `${activity.minAge}+`,
		});
	}
	return facts;
}

export function ActivityFacts({ activity }: { activity: ActivityDetail }) {
	const facts = collectFacts(activity);
	if (facts.length === 0 && activity.categories.length === 0) return null;

	return (
		<div className="flex flex-col gap-4">
			{facts.length > 0 && (
				<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{facts.map((fact) => (
						<div key={fact.label} className="flex items-start gap-3">
							<fact.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
							<div className="flex flex-col">
								<dt className="text-muted-foreground text-xs uppercase tracking-wide">
									{fact.label}
								</dt>
								<dd className="font-medium text-sm">{fact.value}</dd>
							</div>
						</div>
					))}
				</dl>
			)}
			{activity.categories.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{activity.categories.map((category) => (
						<Badge key={category} variant="secondary">
							{category}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}
