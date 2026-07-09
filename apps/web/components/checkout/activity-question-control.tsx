"use client";

import type { ActivityQuestionField } from "@workspace/core/activities";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { Textarea } from "@workspace/ui/components/textarea";
import { isBooleanField } from "@/lib/activities/booking-details";

function inputTypeFor(dataFormat: string | null): string {
	switch (dataFormat) {
		case "EMAIL_ADDRESS":
			return "email";
		case "PHONE_NUMBER":
			return "tel";
		case "TIME":
			return "time";
		default:
			return "text";
	}
}

function RequiredMark({ required }: { required: boolean }) {
	return required ? (
		<span aria-hidden="true" className="text-destructive">
			{" "}
			*
		</span>
	) : null;
}

function QuestionLabel({
	field,
	id,
	required,
}: {
	field: ActivityQuestionField;
	id: string;
	required: boolean;
}) {
	return (
		<Label htmlFor={id}>
			{field.label}
			<RequiredMark required={required} />
		</Label>
	);
}

/**
 * Renders one Bokun booking question as the matching form control. Shared by
 * the checkout questions form and the order hub's post-booking questions
 * editor so a question always looks and behaves the same in both places.
 */
export function ActivityQuestionControl({
	field,
	id,
	value,
	invalid,
	onChange,
	required,
}: {
	field: ActivityQuestionField;
	id: string;
	value: string;
	invalid: boolean;
	onChange: (value: string) => void;
	required?: boolean;
}) {
	const isRequired = required ?? field.required;
	if (isBooleanField(field)) {
		return (
			<label className="flex items-start gap-2" htmlFor={id}>
				<Checkbox
					aria-invalid={invalid}
					checked={value === "true"}
					id={id}
					onCheckedChange={(checked) =>
						onChange(checked === true ? "true" : "")
					}
				/>
				<span className="text-sm leading-tight">
					{field.label}
					<RequiredMark required={isRequired} />
				</span>
			</label>
		);
	}

	// Bokun multi-select required questions are rare; a single choice keeps the
	// answer payload valid. Revisit if a multi-value required question appears.
	if (field.selectFromOptions && field.options.length > 0) {
		return (
			<div className="flex flex-col gap-1.5">
				<QuestionLabel field={field} id={id} required={isRequired} />
				<ResponsiveSelect
					aria-invalid={invalid}
					className="w-full"
					id={id}
					onValueChange={onChange}
					options={[
						{ label: "Select an option", value: "" },
						...field.options.map((option) => ({
							label: option.label,
							value: option.value,
						})),
					]}
					value={value}
				/>
			</div>
		);
	}

	if (field.dataType.toUpperCase() === "LONG_TEXT") {
		return (
			<div className="flex flex-col gap-1.5">
				<QuestionLabel field={field} id={id} required={isRequired} />
				<Textarea
					aria-invalid={invalid}
					id={id}
					onChange={(event) => onChange(event.target.value)}
					rows={3}
					value={value}
				/>
			</div>
		);
	}

	const dataType = field.dataType.toUpperCase();
	const isDate = dataType === "DATE";
	const isTime = dataType === "TIME";
	return (
		<div className="flex flex-col gap-1.5">
			<QuestionLabel field={field} id={id} required={isRequired} />
			<Input
				aria-invalid={invalid}
				id={id}
				onChange={(event) => onChange(event.target.value)}
				type={
					isDate ? "date" : isTime ? "time" : inputTypeFor(field.dataFormat)
				}
				value={value}
			/>
		</div>
	);
}
