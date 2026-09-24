"use client";

import type { DiscountScope } from "@workspace/db";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { DialogClose, DialogFooter } from "@workspace/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@workspace/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
	RadioGroup,
	RadioGroupItem,
} from "@workspace/ui/components/radio-group";
import { Spinner } from "@workspace/ui/components/spinner";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { CalendarIcon, CircleAlert, Dices } from "lucide-react";
import {
	type ChangeEvent,
	type FormEvent,
	type TransitionStartFunction,
	useId,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	type CreatePromotionField,
	type CreatePromotionRequest,
	createPromotionCodeAction,
} from "./actions";
import {
	currencySymbol,
	DEFAULT_SCOPE,
	formatCalendarDay,
	formatMoneyMajor,
	formatPercent,
	generatePromotionCode,
	isDiscountScope,
	lisbonToday,
	PROMOTION_CODE_RULE,
	parseAmount,
	SCOPE_OPTIONS,
	scopePhrase,
	toIsoDay,
} from "./promotion-display";
import { reachServer, UNREACHABLE_MESSAGE } from "./reach-server";

type DiscountType = CreatePromotionRequest["discountType"];
type FieldErrors = Partial<Record<CreatePromotionField, string>>;
type Draft = Omit<CreatePromotionRequest, "requestId">;

const FIELD_ORDER: readonly CreatePromotionField[] = [
	"code",
	"value",
	"expiresOn",
];

function isDiscountType(value: string): value is DiscountType {
	return value === "percentage" || value === "fixed";
}

function validDiscount(draft: Draft): number | null {
	const amount = parseAmount(draft.value);
	if (amount === null || amount <= 0) {
		return null;
	}
	return draft.discountType === "percentage" && amount > 100 ? null : amount;
}

function validateDraft(draft: Draft): FieldErrors {
	const errors: FieldErrors = {};
	if (!draft.code) {
		errors.code = "Enter a code or generate one.";
	} else if (!PROMOTION_CODE_RULE.test(draft.code)) {
		errors.code = "Use 3 to 40 letters, digits or dashes.";
	}

	const amount = parseAmount(draft.value);
	if (amount === null) {
		errors.value = "Enter a number.";
	} else if (amount <= 0) {
		errors.value =
			draft.discountType === "percentage"
				? "Enter a percentage above 0."
				: "Enter an amount above 0.";
	} else if (draft.discountType === "percentage" && amount > 100) {
		errors.value = "A percentage cannot exceed 100.";
	}
	return errors;
}

interface CreatePromotionFormProps {
	currency: string;
	onCreated: () => void;
	pending: boolean;
	startTransition: TransitionStartFunction;
}

/**
 * Lives inside the dialog content, so closing the dialog discards the draft.
 * The transition is owned by the dialog so it can refuse to close mid-request.
 */
export function CreatePromotionForm({
	currency,
	onCreated,
	pending,
	startTransition,
}: CreatePromotionFormProps) {
	const baseId = useId();
	const ids = {
		code: `${baseId}-code`,
		codeHint: `${baseId}-code-hint`,
		expiresOn: `${baseId}-expires`,
		expiresOnHint: `${baseId}-expires-hint`,
		value: `${baseId}-value`,
	} as const;
	const fieldIds: Record<CreatePromotionField, string> = {
		code: ids.code,
		expiresOn: ids.expiresOn,
		value: ids.value,
	};

	const [code, setCode] = useState("");
	const [discountType, setDiscountType] = useState<DiscountType>("percentage");
	const [value, setValue] = useState("");
	const [scope, setScope] = useState<DiscountScope>(DEFAULT_SCOPE);
	const [expiresOn, setExpiresOn] = useState<Date | undefined>(undefined);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [today] = useState(lisbonToday);
	const expiresTriggerRef = useRef<HTMLButtonElement>(null);
	const unresolvedAttempt = useRef<{ key: string; requestId: string } | null>(
		null,
	);

	const draft: Draft = {
		code: code.trim(),
		discountType,
		expiresOn: expiresOn ? toIsoDay(expiresOn) : null,
		scope,
		value,
	};

	function clearFieldError(field: CreatePromotionField) {
		setFieldErrors((current) => {
			if (!current[field]) {
				return current;
			}
			const { [field]: _removed, ...rest } = current;
			return rest;
		});
	}

	function focusField(field: CreatePromotionField) {
		document.getElementById(fieldIds[field])?.focus();
	}

	function handleCodeChange(event: ChangeEvent<HTMLInputElement>) {
		const input = event.currentTarget;
		const upper = input.value.toUpperCase();
		if (upper !== input.value) {
			// Rewriting the DOM value first keeps the caret where the user typed.
			const { selectionEnd, selectionStart } = input;
			input.value = upper;
			input.setSelectionRange(selectionStart, selectionEnd);
		}
		setCode(upper);
		clearFieldError("code");
	}

	function handleExpiryChange(day: Date | undefined) {
		setExpiresOn(day);
		setCalendarOpen(false);
		clearFieldError("expiresOn");
	}

	function clearExpiry() {
		handleExpiryChange(undefined);
		expiresTriggerRef.current?.focus();
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) {
			return;
		}

		setFormError(null);
		const errors = validateDraft(draft);
		const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
		setFieldErrors(errors);
		if (firstInvalid) {
			focusField(firstInvalid);
			return;
		}

		// Stripe idempotency: only a retry of an attempt with an unknown outcome
		// and an unchanged payload may reuse its request id.
		const key = JSON.stringify(draft);
		const requestId =
			unresolvedAttempt.current?.key === key
				? unresolvedAttempt.current.requestId
				: crypto.randomUUID();

		startTransition(async () => {
			const result = await reachServer(() =>
				createPromotionCodeAction({ ...draft, requestId }),
			);
			if (!result) {
				unresolvedAttempt.current = { key, requestId };
				setFormError(UNREACHABLE_MESSAGE);
				return;
			}

			unresolvedAttempt.current = null;
			if (result.ok) {
				toast.success(`Code ${result.code} created`);
				onCreated();
				return;
			}
			if (result.field) {
				setFieldErrors({ [result.field]: result.error });
				focusField(result.field);
			} else {
				setFormError(result.error);
			}
		});
	}

	const valueLabel =
		discountType === "percentage"
			? "Discount percentage"
			: `Discount amount in ${currency}`;

	return (
		<form className="grid gap-6" noValidate onSubmit={handleSubmit}>
			<FieldGroup className="gap-6">
				<Field data-invalid={fieldErrors.code ? true : undefined}>
					<FieldLabel htmlFor={ids.code}>Code</FieldLabel>
					<InputGroup>
						<InputGroupInput
							aria-describedby={ids.codeHint}
							aria-invalid={fieldErrors.code ? true : undefined}
							autoCapitalize="characters"
							autoComplete="off"
							className="font-mono tracking-wide"
							id={ids.code}
							maxLength={40}
							onChange={handleCodeChange}
							placeholder="SUMMER25"
							spellCheck={false}
							value={code}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupButton
								onClick={() => {
									setCode(generatePromotionCode());
									clearFieldError("code");
								}}
							>
								<Dices aria-hidden />
								Generate
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					{fieldErrors.code ? (
						<FieldError id={ids.codeHint}>{fieldErrors.code}</FieldError>
					) : (
						<FieldDescription id={ids.codeHint}>
							What guests type at checkout. Letters, digits and dashes.
						</FieldDescription>
					)}
				</Field>

				<Field data-invalid={fieldErrors.value ? true : undefined}>
					<FieldLabel htmlFor={ids.value}>Discount</FieldLabel>
					<div className="flex flex-col gap-2 sm:flex-row">
						<ToggleGroup
							aria-label="Discount type"
							className="w-full sm:w-auto"
							onValueChange={(next) => {
								if (isDiscountType(next)) {
									setDiscountType(next);
									clearFieldError("value");
								}
							}}
							spacing={0}
							type="single"
							value={discountType}
							variant="outline"
						>
							<ToggleGroupItem className="flex-1" value="percentage">
								Percentage
							</ToggleGroupItem>
							<ToggleGroupItem className="flex-1" value="fixed">
								Fixed amount
							</ToggleGroupItem>
						</ToggleGroup>
						<InputGroup className="sm:flex-1">
							<InputGroupInput
								aria-describedby={
									fieldErrors.value ? `${ids.value}-error` : undefined
								}
								aria-invalid={fieldErrors.value ? true : undefined}
								aria-label={valueLabel}
								autoComplete="off"
								className="tabular-nums"
								id={ids.value}
								inputMode="decimal"
								onChange={(event) => {
									setValue(event.currentTarget.value);
									clearFieldError("value");
								}}
								placeholder={discountType === "percentage" ? "15" : "20.00"}
								value={value}
							/>
							<InputGroupAddon
								align={
									discountType === "percentage" ? "inline-end" : "inline-start"
								}
							>
								{discountType === "percentage" ? "%" : currencySymbol(currency)}
							</InputGroupAddon>
						</InputGroup>
					</div>
					<FieldError id={`${ids.value}-error`}>{fieldErrors.value}</FieldError>
				</Field>

				<FieldSet>
					<FieldLegend variant="label">Applies to</FieldLegend>
					<RadioGroup
						className="gap-2"
						onValueChange={(next) => {
							if (isDiscountScope(next)) {
								setScope(next);
							}
						}}
						value={scope}
					>
						{SCOPE_OPTIONS.map((option) => {
							const optionId = `${baseId}-scope-${option.value}`;
							return (
								<FieldLabel
									className="*:data-[slot=field]:px-4 *:data-[slot=field]:py-3"
									htmlFor={optionId}
									key={option.value}
								>
									<Field orientation="horizontal">
										<FieldContent>
											<FieldTitle>{option.label}</FieldTitle>
											<FieldDescription>{option.description}</FieldDescription>
										</FieldContent>
										<RadioGroupItem id={optionId} value={option.value} />
									</Field>
								</FieldLabel>
							);
						})}
					</RadioGroup>
				</FieldSet>

				<Field data-invalid={fieldErrors.expiresOn ? true : undefined}>
					<FieldLabel htmlFor={ids.expiresOn}>
						Valid through
						<span className="font-normal text-muted-foreground">Optional</span>
					</FieldLabel>
					<div className="flex items-center gap-2">
						<Popover onOpenChange={setCalendarOpen} open={calendarOpen}>
							<PopoverTrigger asChild>
								<Button
									aria-describedby={ids.expiresOnHint}
									aria-invalid={fieldErrors.expiresOn ? true : undefined}
									aria-label={
										expiresOn
											? `Valid through ${formatCalendarDay(expiresOn)}`
											: "Valid through: no end date"
									}
									className="min-w-0 flex-1 justify-start font-normal sm:w-56 sm:flex-none"
									id={ids.expiresOn}
									ref={expiresTriggerRef}
									type="button"
									variant="outline"
								>
									<CalendarIcon aria-hidden data-icon="inline-start" />
									{expiresOn ? (
										formatCalendarDay(expiresOn)
									) : (
										<span className="text-muted-foreground">No end date</span>
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent align="start" className="w-auto p-0">
								<Calendar
									autoFocus
									defaultMonth={expiresOn ?? today}
									disabled={{ before: today }}
									mode="single"
									onSelect={handleExpiryChange}
									selected={expiresOn}
									startMonth={today}
									weekStartsOn={1}
								/>
							</PopoverContent>
						</Popover>
						{expiresOn ? (
							<Button
								aria-label="Clear end date"
								onClick={clearExpiry}
								type="button"
								variant="ghost"
							>
								Clear
							</Button>
						) : null}
					</div>
					{fieldErrors.expiresOn ? (
						<FieldError id={ids.expiresOnHint}>
							{fieldErrors.expiresOn}
						</FieldError>
					) : (
						<FieldDescription id={ids.expiresOnHint}>
							Leave empty to keep the code valid until you deactivate it.
						</FieldDescription>
					)}
				</Field>
			</FieldGroup>

			<PromotionSummary
				currency={currency}
				draft={draft}
				expiresOn={expiresOn}
			/>

			{formError ? (
				<Alert variant="destructive">
					<CircleAlert aria-hidden />
					<AlertTitle>The code was not created</AlertTitle>
					<AlertDescription>{formError}</AlertDescription>
				</Alert>
			) : null}

			<DialogFooter>
				<DialogClose asChild>
					<Button disabled={pending} type="button" variant="outline">
						Cancel
					</Button>
				</DialogClose>
				<Button disabled={pending} type="submit">
					{pending ? (
						<>
							<Spinner aria-hidden data-icon="inline-start" />
							Creating code
						</>
					) : (
						"Create code"
					)}
				</Button>
			</DialogFooter>
		</form>
	);
}

function PromotionSummary({
	currency,
	draft,
	expiresOn,
}: {
	currency: string;
	draft: Draft;
	expiresOn: Date | undefined;
}) {
	const amount = validDiscount(draft);
	const validity = expiresOn
		? `valid through ${formatCalendarDay(expiresOn)}`
		: "valid until you deactivate it";

	return (
		<div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed">
			{amount === null ? (
				<p className="text-muted-foreground">
					Enter a discount to preview what the code does.
				</p>
			) : (
				<p>
					{draft.code ? (
						<span className="font-medium font-mono">{draft.code}</span>
					) : (
						"This code"
					)}{" "}
					takes{" "}
					<span className="font-medium">
						{draft.discountType === "percentage"
							? formatPercent(amount)
							: formatMoneyMajor(amount, currency)}
					</span>{" "}
					off {scopePhrase(draft.scope)}, {validity}.
				</p>
			)}
		</div>
	);
}
