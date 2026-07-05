import type { ActivityDetail } from "@workspace/core/activities";
import { Separator } from "@workspace/ui/components/separator";
import { formatActivityHtml } from "@/lib/activities/format";

function Prose({ blocks }: { blocks: string[] }) {
	return (
		<div className="flex flex-col gap-3 text-muted-foreground leading-relaxed">
			{blocks.map((block, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: prose blocks are positional
				<p key={index} className="whitespace-pre-line">
					{block}
				</p>
			))}
		</div>
	);
}

function Section({ title, html }: { title: string; html: string | null }) {
	const blocks = formatActivityHtml(html);
	if (blocks.length === 0) return null;
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-heading font-semibold text-xl">{title}</h2>
			<Prose blocks={blocks} />
		</section>
	);
}

export function ActivityDescription({
	activity,
}: {
	activity: ActivityDetail;
}) {
	const hasAgenda = activity.agenda.some((item) => item.title || item.body);

	return (
		<div className="flex flex-col gap-8">
			<Section title="About this activity" html={activity.description} />
			<Section title="What's included" html={activity.included} />
			<Section title="Not included" html={activity.excluded} />
			<Section title="What to bring" html={activity.requirements} />
			<Section title="Good to know" html={activity.attention} />

			{hasAgenda && (
				<section className="flex flex-col gap-4">
					<h2 className="font-heading font-semibold text-xl">Itinerary</h2>
					<ol className="flex flex-col gap-4">
						{activity.agenda.map((item, index) => (
							<li
								// biome-ignore lint/suspicious/noArrayIndexKey: agenda is positional
								key={index}
								className="flex flex-col gap-1 border-border border-l-2 pl-4"
							>
								{item.title && (
									<p className="font-medium">
										{item.day !== null ? `Day ${item.day}: ` : ""}
										{item.title}
									</p>
								)}
								{item.body && <Prose blocks={formatActivityHtml(item.body)} />}
							</li>
						))}
					</ol>
				</section>
			)}
			<Separator />
		</div>
	);
}
