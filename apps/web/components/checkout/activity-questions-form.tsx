"use client";

import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { NativeSelect } from "@workspace/ui/components/native-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	type ActivityBookingDescription,
	type ActivityBookingDraft,
	type ActivityPassengerGroup,
	type ActivityPlacePrompt,
	type ActivityQuestionEntry,
	isBooleanField,
	placeAsksRoom,
	resolvePlaceId,
} from "@/lib/activities/booking-details";
import type {
	ActivityBookingEntry,
	UseActivityBookingDetails,
} from "./use-activity-booking-details";

interface ActivityQuestionsFormProps {
	booking: UseActivityBookingDetails;
	/** Set after a failed submit so required-but-empty fields highlight. */
	showErrors: boolean;
}

type ReadyActivityBookingEntry = ActivityBookingEntry & {
	state: Extract<ActivityBookingEntry["state"], { status: "ready" }>;
};

function inputTypeFor(dataFormat: string | null): string {
	switch (dataFormat) {
		case "EMAIL_ADDRESS":
			return "email";
		case "PHONE_NUMBER":
			return "tel";
		default:
			return "text";
	}
}

function QuestionControl({
	entry,
	value,
	invalid,
	onChange,
}: {
	entry: ActivityQuestionEntry;
	value: string;
	invalid: boolean;
	onChange: (value: string) => void;
}) {
	const { field, key } = entry;

	if (isBooleanField(field)) {
		return (
			<label className="flex items-start gap-2" htmlFor={key}>
				<Checkbox
					aria-invalid={invalid}
					checked={value === "true"}
					id={key}
					onCheckedChange={(checked) =>
						onChange(checked === true ? "true" : "")
					}
				/>
				<span className="text-sm leading-tight">{field.label}</span>
			</label>
		);
	}

	// Bokun multi-select required questions are rare; a single choice keeps the
	// answer payload valid. Revisit if a multi-value required question appears.
	if (field.selectFromOptions && field.options.length > 0) {
		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={key}>{field.label}</Label>
				<NativeSelect
					aria-invalid={invalid}
					className="w-full"
					id={key}
					onChange={(event) => onChange(event.target.value)}
					value={value}
				>
					<option value="">Select an option</option>
					{field.options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</NativeSelect>
			</div>
		);
	}

	if (field.dataType.toUpperCase() === "LONG_TEXT") {
		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={key}>{field.label}</Label>
				<Textarea
					aria-invalid={invalid}
					id={key}
					onChange={(event) => onChange(event.target.value)}
					rows={3}
					value={value}
				/>
			</div>
		);
	}

	const isDate = field.dataType.toUpperCase() === "DATE";
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={key}>{field.label}</Label>
			<Input
				aria-invalid={invalid}
				id={key}
				onChange={(event) => onChange(event.target.value)}
				type={isDate ? "date" : inputTypeFor(field.dataFormat)}
				value={value}
			/>
		</div>
	);
}

function PlaceControl({
	cartItemId,
	prompt,
	draft,
	invalid,
	onSelect,
}: {
	cartItemId: string;
	prompt: ActivityPlacePrompt;
	draft: ActivityBookingDraft;
	invalid: boolean;
	onSelect: (cartItemId: string, placeId: string | null) => void;
}) {
	const selected =
		prompt.kind === "pickup" ? draft.pickupPlaceId : draft.dropoffPlaceId;
	const id = `${prompt.kind}-${cartItemId}`;
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{prompt.label}</Label>
			<NativeSelect
				aria-invalid={invalid}
				className="w-full"
				id={id}
				onChange={(event) => onSelect(cartItemId, event.target.value || null)}
				value={selected ?? ""}
			>
				<option value="">Select a location</option>
				{prompt.places.map((place) => (
					<option key={place.id} value={place.id}>
						{place.title}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

function answerInvalid(
	entry: ActivityQuestionEntry,
	draft: ActivityBookingDraft,
	showErrors: boolean,
): boolean {
	if (!showErrors) {
		return false;
	}
	const value = draft.answers[entry.key] ?? "";
	return isBooleanField(entry.field)
		? value !== "true"
		: value.trim().length === 0;
}

function isPassengerComplete(
	group: ActivityPassengerGroup,
	draft: ActivityBookingDraft,
): boolean {
	return group.questions.every(
		(question) => !answerInvalid(question, draft, true),
	);
}

function activityGuestDetailsNeedInput(
	description: ActivityBookingDescription,
): boolean {
	const pickupRoomPossible =
		description.pickup?.places.some((place) => place.askForRoomNumber) ?? false;
	return (
		description.activityQuestions.length > 0 ||
		description.passengers.length > 0 ||
		(description.pickup?.selectable ?? false) ||
		(description.dropoff?.selectable ?? false) ||
		pickupRoomPossible
	);
}

function hasMainContactQuestions(
	entry: ActivityBookingEntry,
): entry is ReadyActivityBookingEntry {
	return (
		entry.state.status === "ready" &&
		entry.state.description.contactQuestions.length > 0
	);
}

/**
 * One passenger at a time with a numbered step indicator, so a large party does
 * not turn into a long scroll of repeated question blocks. Steps are freely
 * navigable (the overall submit gate still enforces completeness); the indicator
 * marks done passengers and flags any left empty once a submit is attempted.
 */
function PassengerCarousel({
	groups,
	draft,
	showErrors,
	renderQuestion,
}: {
	groups: ActivityPassengerGroup[];
	draft: ActivityBookingDraft;
	showErrors: boolean;
	renderQuestion: (question: ActivityQuestionEntry) => ReactNode;
}) {
	const [step, setStep] = useState(0);
	const active = Math.min(step, groups.length - 1);
	const group = groups[active];
	if (!group) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-1.5">
				{groups.map((entry, index) => {
					const complete = isPassengerComplete(entry, draft);
					const isActive = index === active;
					return (
						<button
							aria-current={isActive}
							aria-label={entry.label}
							className={cn(
								"flex size-7 items-center justify-center rounded-full border font-medium text-xs transition-colors",
								isActive
									? "border-primary bg-primary text-primary-foreground"
									: complete
										? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
										: showErrors
											? "border-destructive text-destructive"
											: "border-border text-muted-foreground",
							)}
							key={entry.participantIndex}
							onClick={() => setStep(index)}
							type="button"
						>
							{complete && !isActive ? (
								<Check className="size-3.5" />
							) : (
								index + 1
							)}
						</button>
					);
				})}
			</div>

			<div className="flex items-center justify-between">
				<p className="font-medium text-sm">{group.label}</p>
				<span className="text-muted-foreground text-xs">
					Guest {active + 1} of {groups.length}
				</span>
			</div>

			{group.questions.map(renderQuestion)}

			<div className="flex items-center justify-between gap-2 pt-1">
				<Button
					disabled={active === 0}
					onClick={() => setStep((value) => Math.max(0, value - 1))}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ChevronLeft className="size-4" />
					Back
				</Button>
				<Button
					disabled={active >= groups.length - 1}
					onClick={() =>
						setStep((value) => Math.min(groups.length - 1, value + 1))
					}
					size="sm"
					type="button"
					variant="outline"
				>
					Next
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function ItemQuestions({
	entry,
	description,
	booking,
	showErrors,
	showTitle,
}: {
	entry: ActivityBookingEntry;
	description: ActivityBookingDescription;
	booking: UseActivityBookingDetails;
	showErrors: boolean;
	showTitle: boolean;
}) {
	const { draft, item } = entry;
	const { setAnswer, setPickupPlace, setDropoffPlace, setRoomNumber } = booking;
	const pickupId = resolvePlaceId(description.pickup, draft.pickupPlaceId);
	const asksRoom = placeAsksRoom(description.pickup, pickupId);

	const renderQuestion = (question: ActivityQuestionEntry) => (
		<QuestionControl
			entry={question}
			invalid={answerInvalid(question, draft, showErrors)}
			key={question.key}
			onChange={(value) => setAnswer(item.id, question.key, value)}
			value={draft.answers[question.key] ?? ""}
		/>
	);

	return (
		<div className="flex flex-col gap-4">
			{showTitle && <p className="font-medium text-sm">{item.title}</p>}

			{description.pickup?.selectable && (
				<PlaceControl
					cartItemId={item.id}
					draft={draft}
					invalid={showErrors && !pickupId}
					onSelect={setPickupPlace}
					prompt={description.pickup}
				/>
			)}
			{asksRoom && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`room-${item.id}`}>Room number</Label>
					<Input
						aria-invalid={showErrors && draft.roomNumber.trim().length === 0}
						id={`room-${item.id}`}
						onChange={(event) => setRoomNumber(item.id, event.target.value)}
						value={draft.roomNumber}
					/>
				</div>
			)}
			{description.dropoff?.selectable && (
				<PlaceControl
					cartItemId={item.id}
					draft={draft}
					invalid={
						showErrors &&
						!resolvePlaceId(description.dropoff, draft.dropoffPlaceId)
					}
					onSelect={setDropoffPlace}
					prompt={description.dropoff}
				/>
			)}

			{description.activityQuestions.map(renderQuestion)}

			{description.passengers.length > 1 ? (
				<PassengerCarousel
					draft={draft}
					groups={description.passengers}
					renderQuestion={renderQuestion}
					showErrors={showErrors}
				/>
			) : (
				description.passengers.map((group) => (
					<div className="flex flex-col gap-3" key={group.participantIndex}>
						<p className="text-muted-foreground text-xs uppercase tracking-wide">
							{group.label}
						</p>
						{group.questions.map(renderQuestion)}
					</div>
				))
			)}
		</div>
	);
}

/**
 * Required provider fields that belong to the booking's main contact. Rendered
 * inside the contact form so these stay with full name, email and phone instead
 * of being mixed into per-guest activity questions.
 */
export function ActivityMainContactQuestions({
	booking,
	showErrors,
}: ActivityQuestionsFormProps) {
	const visible = booking.entries.filter(hasMainContactQuestions);
	if (visible.length === 0) {
		return null;
	}
	const showTitle = booking.entries.length > 1;

	return (
		<div className="flex flex-col gap-4">
			{visible.map((entry, index) => {
				const { draft, item } = entry;
				const renderQuestion = (question: ActivityQuestionEntry) => (
					<QuestionControl
						entry={question}
						invalid={answerInvalid(question, draft, showErrors)}
						key={question.key}
						onChange={(value) =>
							booking.setAnswer(item.id, question.key, value)
						}
						value={draft.answers[question.key] ?? ""}
					/>
				);

				return (
					<div className="flex flex-col gap-4" key={item.id}>
						{index > 0 && <div className="border-t" />}
						{showTitle && <p className="font-medium text-sm">{item.title}</p>}
						{entry.state.description.contactQuestions.map(renderQuestion)}
					</div>
				);
			})}
		</div>
	);
}

/**
 * Collects the Bokun-required booking questions and pickup/drop-off places for
 * every activity in the cart, inline in the checkout contact step. Renders
 * nothing once all schemas resolve with no guest input required, so the common
 * case adds zero friction. Answers ride on the draft-order body at submit.
 */
export function ActivityQuestionsForm({
	booking,
	showErrors,
}: ActivityQuestionsFormProps) {
	const visible = booking.entries.filter(
		(entry) =>
			entry.state.status !== "ready" ||
			activityGuestDetailsNeedInput(entry.state.description),
	);
	if (visible.length === 0) {
		return null;
	}
	const showTitle = booking.entries.length > 1;

	return (
		<section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-6">
			<div className="flex flex-col gap-1">
				<h2 className="font-medium text-base">Activity and guest details</h2>
				<p className="text-muted-foreground text-sm">
					A few details the operator needs for your booking.
				</p>
			</div>

			{visible.map((entry, index) => (
				<div className="flex flex-col gap-4" key={entry.item.id}>
					{index > 0 && <div className="border-t" />}
					{entry.state.status === "loading" && (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-9 w-full rounded-lg" />
						</div>
					)}
					{entry.state.status === "error" && (
						<div className="flex flex-col items-start gap-2">
							<p className="text-destructive text-sm">
								We couldn't load the booking questions for {entry.item.title}.
							</p>
							<Button
								onClick={() => booking.retry(entry.item.id)}
								size="sm"
								type="button"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					)}
					{entry.state.status === "ready" && (
						<ItemQuestions
							booking={booking}
							description={entry.state.description}
							entry={entry}
							showErrors={showErrors}
							showTitle={showTitle}
						/>
					)}
				</div>
			))}
		</section>
	);
}
