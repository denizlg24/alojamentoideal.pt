import type {
	ActivityQuestionField,
	ActivityQuestionOption,
} from "./booking-schema";

export function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (typeof value === "number") {
		return String(value);
	}
	return null;
}

export function asBoolean(value: unknown): boolean {
	return value === true;
}

export function parseOptions(raw: unknown): ActivityQuestionOption[] {
	const options: ActivityQuestionOption[] = [];
	for (const entry of asArray(raw)) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const value = asString(record.value);
		if (value === null) {
			continue;
		}
		options.push({ label: asString(record.label) ?? value, value });
	}
	return options;
}

export function parseQuestion(raw: unknown): ActivityQuestionField | null {
	const record = asRecord(raw);
	if (!record) {
		return null;
	}
	const questionId = asString(record.questionId);
	if (questionId === null) {
		return null;
	}
	return {
		dataFormat: asString(record.dataFormat),
		dataType: asString(record.dataType) ?? "SHORT_TEXT",
		label: asString(record.label) ?? questionId,
		options: parseOptions(record.answerOptions),
		questionId,
		required: asBoolean(record.required),
		selectFromOptions: asBoolean(record.selectFromOptions),
		selectMultiple: asBoolean(record.selectMultiple),
	};
}

export function parseQuestions(raw: unknown): ActivityQuestionField[] {
	const fields: ActivityQuestionField[] = [];
	for (const entry of asArray(raw)) {
		const field = parseQuestion(entry);
		if (field) {
			fields.push(field);
		}
	}
	return fields;
}
