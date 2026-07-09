"use client";

import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	type ActivityBookingDescription,
	type ActivityBookingDraft,
	type ActivityPassengerGroup,
	type ActivityPlacePrompt,
	type ActivityQuestionEntry,
	activeDropoffQuestions,
	activePickupQuestions,
	CUSTOM_PICKUP_PLACE_ID,
	isBooleanField,
	placeDetailsPossible,
	resolvePlaceId,
} from "@/lib/activities/booking-details";
import { ActivityQuestionControl } from "./activity-question-control";
import { PassengerStepCarousel } from "./passenger-step-carousel";
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

function RequiredMark({ required }: { required: boolean }) {
	return required ? (
		<span aria-hidden="true" className="text-destructive">
			{" "}
			*
		</span>
	) : null;
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
	const isPickup = prompt.kind === "pickup";
	const options = [
		...(prompt.optional
			? [
					{
						label: isPickup ? "No pickup needed" : "No drop-off needed",
						value: "",
					},
				]
			: !prompt.customAllowed
				? [{ label: "Select a location", value: "" }]
				: []),
		...(isPickup && prompt.customAllowed
			? [
					{
						label: "I want to specify my own pick-up",
						value: CUSTOM_PICKUP_PLACE_ID,
					},
				]
			: []),
		...prompt.places.map((place) => ({ label: place.title, value: place.id })),
	];
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>
				{prompt.label}
				<RequiredMark required={!prompt.optional} />
			</Label>
			<ResponsiveSelect
				aria-invalid={invalid}
				className="w-full"
				id={id}
				onValueChange={(value) => onSelect(cartItemId, value || null)}
				options={options}
				placeholder="Select a location"
				value={resolvePlaceId(prompt, selected) ?? ""}
			/>
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
	if (!entry.required) {
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
	const pickupQuestionsPossible = placeDetailsPossible(description.pickup);
	const dropoffQuestionsPossible = placeDetailsPossible(description.dropoff);
	return (
		description.activityQuestions.length > 0 ||
		description.passengers.length > 0 ||
		(description.pickup?.selectable ?? false) ||
		(description.dropoff?.selectable ?? false) ||
		pickupQuestionsPossible ||
		dropoffQuestionsPossible
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
	const { setAnswer, setPickupPlace, setDropoffPlace } = booking;
	const pickupId = resolvePlaceId(description.pickup, draft.pickupPlaceId);
	const pickupQuestions = activePickupQuestions(description, draft);
	const dropoffQuestions = activeDropoffQuestions(description, draft);

	const renderQuestion = (question: ActivityQuestionEntry) => (
		<ActivityQuestionControl
			field={question.field}
			id={question.key}
			invalid={answerInvalid(question, draft, showErrors)}
			key={question.key}
			onChange={(value) => setAnswer(item.id, question.key, value)}
			required={question.required}
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
					invalid={showErrors && !description.pickup.optional && !pickupId}
					onSelect={setPickupPlace}
					prompt={description.pickup}
				/>
			)}
			{pickupQuestions.length > 0 && (
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs uppercase tracking-wide">
						Pickup details
					</p>
					{pickupQuestions.map(renderQuestion)}
				</div>
			)}
			{description.dropoff?.selectable && (
				<PlaceControl
					cartItemId={item.id}
					draft={draft}
					invalid={
						showErrors &&
						!description.dropoff.optional &&
						!resolvePlaceId(description.dropoff, draft.dropoffPlaceId)
					}
					onSelect={setDropoffPlace}
					prompt={description.dropoff}
				/>
			)}
			{dropoffQuestions.length > 0 && (
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs uppercase tracking-wide">
						Drop-off details
					</p>
					{dropoffQuestions.map(renderQuestion)}
				</div>
			)}

			{description.activityQuestions.map(renderQuestion)}

			{description.passengers.length > 1 ? (
				<PassengerStepCarousel
					showErrors={showErrors}
					steps={description.passengers.map((group) => ({
						complete: isPassengerComplete(group, draft),
						content: group.questions.map(renderQuestion),
						key: String(group.participantIndex),
						label: group.label,
					}))}
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
					<ActivityQuestionControl
						field={question.field}
						id={question.key}
						invalid={answerInvalid(question, draft, showErrors)}
						key={question.key}
						onChange={(value) =>
							booking.setAnswer(item.id, question.key, value)
						}
						required={question.required}
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
