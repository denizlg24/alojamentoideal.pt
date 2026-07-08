"use client";

import type {
	ActivityAnsweredQuestion,
	ActivityBookingQuestionsSnapshot,
	BookingQuestionAnswerGroup,
	BookingQuestionAnswerUpdate,
} from "@workspace/core/activities";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ActivityQuestionControl } from "@/components/checkout/activity-question-control";
import { PassengerStepCarousel } from "@/components/checkout/passenger-step-carousel";
import { isBooleanField } from "@/lib/activities/booking-details";
import { saveActivityQuestionAnswers } from "@/lib/order/api-client";

interface QuestionEntry {
	field: ActivityAnsweredQuestion;
	group: BookingQuestionAnswerGroup;
	key: string;
	passengerBookingId: string | null;
}

interface QuestionSection {
	entries: QuestionEntry[];
	key: string;
	kind: "general" | "passenger";
	title: string | null;
}

function entryKey(
	group: BookingQuestionAnswerGroup,
	passengerBookingId: string | null,
	questionId: string,
): string {
	return `${group}::${passengerBookingId ?? "-"}::${questionId}`;
}

function toEntries(
	group: BookingQuestionAnswerGroup,
	passengerBookingId: string | null,
	fields: ActivityAnsweredQuestion[],
): QuestionEntry[] {
	return fields.map((field) => ({
		field,
		group,
		key: entryKey(group, passengerBookingId, field.questionId),
		passengerBookingId,
	}));
}

/**
 * Flattens the provider snapshot into labeled sections in a stable render
 * order: main contact, per-booking activity questions, pickup details, then
 * each passenger. Sections with no questions are dropped.
 */
function toSections(
	snapshot: ActivityBookingQuestionsSnapshot,
): QuestionSection[] {
	const sections: QuestionSection[] = [
		{
			entries: toEntries("mainContact", null, snapshot.mainContactDetails),
			key: "mainContact",
			kind: "general",
			title: "Contact details",
		},
	];
	for (const booking of snapshot.activityBookings) {
		sections.push({
			entries: toEntries("activity", null, booking.questions),
			key: `activity-${booking.bookingId ?? "-"}`,
			kind: "general",
			title: null,
		});
		sections.push({
			entries: toEntries("pickup", null, booking.pickupQuestions),
			key: `pickup-${booking.bookingId ?? "-"}`,
			kind: "general",
			title: "Pickup details",
		});
		booking.passengers.forEach((passenger, index) => {
			sections.push({
				entries: [
					...toEntries(
						"passengerDetails",
						passenger.bookingId,
						passenger.passengerDetails,
					),
					...toEntries(
						"passengerQuestions",
						passenger.bookingId,
						passenger.questions,
					),
				],
				key: `passenger-${passenger.bookingId ?? index}`,
				kind: "passenger",
				title: passenger.title
					? `${passenger.title} ${index + 1}`
					: `Guest ${index + 1}`,
			});
		});
	}
	return sections.filter((section) => section.entries.length > 0);
}

function initialValues(sections: QuestionSection[]): Record<string, string> {
	const values: Record<string, string> = {};
	for (const section of sections) {
		for (const entry of section.entries) {
			values[entry.key] = entry.field.answers[0] ?? "";
		}
	}
	return values;
}

function entryInvalid(entry: QuestionEntry, value: string): boolean {
	if (!entry.field.required) {
		return false;
	}
	return isBooleanField(entry.field)
		? value !== "true"
		: value.trim().length === 0;
}

type SaveState =
	| { status: "error"; message: string }
	| { status: "idle" }
	| { status: "saved" }
	| { status: "saving" };

/**
 * Post-booking editor for the operator's questions on one activity item. All
 * questions are editable (optional ones included); saving pushes the whole
 * answer set to the provider and refreshes the page so the missing-info note
 * above recomputes.
 */
export function OrderActivityQuestions({
	itemId,
	reference,
	snapshot,
}: {
	itemId: string;
	reference: string;
	snapshot: ActivityBookingQuestionsSnapshot;
}) {
	const router = useRouter();
	const sections = useMemo(() => toSections(snapshot), [snapshot]);
	const [values, setValues] = useState<Record<string, string>>(() =>
		initialValues(sections),
	);
	const [showErrors, setShowErrors] = useState(false);
	const [save, setSave] = useState<SaveState>({ status: "idle" });

	if (sections.length === 0) {
		return null;
	}

	const allEntries = sections.flatMap((section) => section.entries);

	async function submit() {
		const hasInvalid = allEntries.some((entry) =>
			entryInvalid(entry, values[entry.key] ?? ""),
		);
		if (hasInvalid) {
			setShowErrors(true);
			setSave({
				message: "Please answer every required question.",
				status: "error",
			});
			return;
		}

		setSave({ status: "saving" });
		const answers: BookingQuestionAnswerUpdate[] = allEntries.map((entry) => {
			const value = (values[entry.key] ?? "").trim();
			return {
				group: entry.group,
				passengerBookingId: entry.passengerBookingId,
				questionId: entry.field.questionId,
				values: value ? [value] : [],
			};
		});
		try {
			await saveActivityQuestionAnswers(reference, itemId, answers);
			setShowErrors(false);
			setSave({ status: "saved" });
			router.refresh();
		} catch (caught) {
			setSave({
				message:
					caught instanceof Error
						? caught.message
						: "Could not save your answers.",
				status: "error",
			});
		}
	}

	const renderEntry = (entry: QuestionEntry) => (
		<ActivityQuestionControl
			field={entry.field}
			id={entry.key}
			invalid={showErrors && entryInvalid(entry, values[entry.key] ?? "")}
			key={entry.key}
			onChange={(value) => {
				setValues((current) => ({ ...current, [entry.key]: value }));
				setSave((current) =>
					current.status === "saved" ? { status: "idle" } : current,
				);
			}}
			value={values[entry.key] ?? ""}
		/>
	);

	const generalSections = sections.filter(
		(section) => section.kind === "general",
	);
	const passengerSections = sections.filter(
		(section) => section.kind === "passenger",
	);

	return (
		<div className="flex flex-col gap-5">
			{generalSections.map((section) => (
				<div className="flex flex-col gap-3" key={section.key}>
					{section.title && (
						<p className="text-muted-foreground text-xs uppercase tracking-wide">
							{section.title}
						</p>
					)}
					{section.entries.map(renderEntry)}
				</div>
			))}

			{passengerSections.length > 1 ? (
				<PassengerStepCarousel
					showErrors={showErrors}
					steps={passengerSections.map((section) => ({
						complete: section.entries.every(
							(entry) => !entryInvalid(entry, values[entry.key] ?? ""),
						),
						content: section.entries.map(renderEntry),
						key: section.key,
						label: section.title ?? "Guest",
					}))}
				/>
			) : (
				passengerSections.map((section) => (
					<div className="flex flex-col gap-3" key={section.key}>
						{section.title && (
							<p className="text-muted-foreground text-xs uppercase tracking-wide">
								{section.title}
							</p>
						)}
						{section.entries.map(renderEntry)}
					</div>
				))
			)}

			<div className="flex items-center gap-3">
				<Button
					disabled={save.status === "saving"}
					onClick={submit}
					size="sm"
					type="button"
				>
					{save.status === "saving" ? "Saving..." : "Save answers"}
				</Button>
				{save.status === "saved" && (
					<span className="text-muted-foreground text-sm">Answers saved.</span>
				)}
				{save.status === "error" && (
					<span className="text-destructive text-sm">{save.message}</span>
				)}
			</div>
		</div>
	);
}
