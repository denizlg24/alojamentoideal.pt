"use client";

import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

/** Radix Select disallows empty item values, so "" round-trips through this. */
const EMPTY_VALUE = "__empty__";

interface ResponsiveSelectOption {
	disabled?: boolean;
	/** Rendered before the label on desktop; native options are text-only. */
	icon?: React.ReactNode;
	label: string;
	/** "" is allowed and represents the cleared / none state. */
	value: string;
}

interface ResponsiveSelectProps {
	"aria-describedby"?: React.AriaAttributes["aria-describedby"];
	"aria-invalid"?: React.AriaAttributes["aria-invalid"];
	"aria-label"?: string;
	"aria-labelledby"?: React.AriaAttributes["aria-labelledby"];
	autoComplete?: string;
	/** Styles the native select wrapper on mobile and the trigger on desktop. */
	className?: string;
	contentClassName?: string;
	disabled?: boolean;
	id?: string;
	name?: string;
	/** Extra classes for the native <select> element on mobile only. */
	nativeSelectClassName?: string;
	onValueChange: (value: string) => void;
	options: readonly ResponsiveSelectOption[];
	/** Shown while `value` is "" and no explicit "" option exists. */
	placeholder?: string;
	required?: boolean;
	size?: "sm" | "default";
	/** Extra classes for the shadcn trigger on desktop only. */
	triggerClassName?: string;
	value: string;
}

/**
 * Single-value select that renders the browser's native picker on mobile
 * (best touch UX) and the shadcn/Radix select on desktop.
 */
export function ResponsiveSelect({
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	autoComplete,
	className,
	contentClassName,
	disabled,
	id,
	name,
	nativeSelectClassName,
	onValueChange,
	options,
	placeholder,
	required,
	size = "default",
	triggerClassName,
	value,
}: ResponsiveSelectProps) {
	const isMobile = useIsMobile();
	const hasEmptyOption = options.some((option) => option.value === "");

	if (isMobile) {
		return (
			<NativeSelect
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				autoComplete={autoComplete}
				className={className}
				disabled={disabled}
				id={id}
				name={name}
				onChange={(event) => onValueChange(event.target.value)}
				required={required}
				selectClassName={nativeSelectClassName}
				size={size}
				value={value}
			>
				{!hasEmptyOption && placeholder ? (
					<NativeSelectOption disabled value="">
						{placeholder}
					</NativeSelectOption>
				) : null}
				{options.map((option) => (
					<NativeSelectOption
						disabled={option.disabled}
						key={option.value}
						value={option.value}
					>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		);
	}

	return (
		<Select
			disabled={disabled}
			name={name}
			onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
			required={required}
			value={
				value === "" ? (hasEmptyOption ? EMPTY_VALUE : undefined) : value
			}
		>
			<SelectTrigger
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				className={cn(className, triggerClassName)}
				id={id}
				size={size}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent className={contentClassName}>
				{options.map((option) => (
					<SelectItem
						disabled={option.disabled}
						key={option.value}
						value={option.value === "" ? EMPTY_VALUE : option.value}
					>
						{option.icon}
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export type { ResponsiveSelectOption, ResponsiveSelectProps };
