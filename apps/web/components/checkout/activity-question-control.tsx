"use client";

import type { ActivityQuestionField } from "@workspace/core/activities";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { NativeSelect } from "@workspace/ui/components/native-select";
import { Textarea } from "@workspace/ui/components/textarea";
import { isBooleanField } from "@/lib/activities/booking-details";

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
}: {
	field: ActivityQuestionField;
	id: string;
	value: string;
	invalid: boolean;
	onChange: (value: string) => void;
}) {
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
				<span className="text-sm leading-tight">{field.label}</span>
			</label>
		);
	}

	// Bokun multi-select required questions are rare; a single choice keeps the
	// answer payload valid. Revisit if a multi-value required question appears.
	if (field.selectFromOptions && field.options.length > 0) {
		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={id}>{field.label}</Label>
				<NativeSelect
					aria-invalid={invalid}
					className="w-full"
					id={id}
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
				<Label htmlFor={id}>{field.label}</Label>
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

	const isDate = field.dataType.toUpperCase() === "DATE";
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{field.label}</Label>
			<Input
				aria-invalid={invalid}
				id={id}
				onChange={(event) => onChange(event.target.value)}
				type={isDate ? "date" : inputTypeFor(field.dataFormat)}
				value={value}
			/>
		</div>
	);
}
