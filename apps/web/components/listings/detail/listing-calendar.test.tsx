import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import type { DateRange } from "react-day-picker";
import { renderToStaticMarkup } from "react-dom/server";
import { parseIsoDate } from "@/lib/catalog/dates";

interface CapturedCalendarProps {
	modifiers?: Record<string, (date: Date) => boolean>;
	modifiersClassNames?: Record<string, string>;
	onSelect?: (range: DateRange | undefined) => void;
}

let lastCalendarProps: CapturedCalendarProps | null = null;

mock.module("@workspace/ui/components/calendar", () => ({
	Calendar: (props: CapturedCalendarProps) => {
		lastCalendarProps = props;
		return React.createElement("div", { "data-calendar": true });
	},
	CalendarDayButton: (props: Record<string, unknown>) =>
		React.createElement("button", { ...props, type: "button" }),
}));

const { ListingCalendar } = await import("./listing-calendar");

function renderCalendar(
	props: Partial<React.ComponentProps<typeof ListingCalendar>> = {},
): {
	calls: Array<DateRange | undefined>;
	calendarProps: CapturedCalendarProps;
} {
	lastCalendarProps = null;
	const calls: Array<DateRange | undefined> = [];

	renderToStaticMarkup(
		React.createElement(ListingCalendar, {
			availableDates: null,
			ctdDates: ["2099-07-08"],
			onChange: (range) => calls.push(range),
			value: { from: parseIsoDate("2099-07-06") },
			...props,
		}),
	);

	if (!lastCalendarProps) {
		throw new Error("ListingCalendar did not render Calendar");
	}

	return { calls, calendarProps: lastCalendarProps };
}

describe("ListingCalendar", () => {
	test("collapses a closed-to-departure checkout to arrival-only", () => {
		const from = parseIsoDate("2099-07-06");
		const to = parseIsoDate("2099-07-08");
		const { calls, calendarProps } = renderCalendar({
			value: { from },
		});

		calendarProps.onSelect?.({ from, to });

		expect(calls.length).toBe(1);
		expect(calls[0]?.from).toBe(from);
		expect(calls[0]?.to).toBe(undefined);
	});

	test("marks closed-to-departure dates with a visual modifier", () => {
		const { calendarProps } = renderCalendar();

		expect(
			calendarProps.modifiers?.closedToDeparture?.(parseIsoDate("2099-07-08")),
		).toBe(true);
		expect(
			calendarProps.modifiers?.closedToDeparture?.(parseIsoDate("2099-07-09")),
		).toBe(false);
		expect(calendarProps.modifiersClassNames?.closedToDeparture).toBe(
			"line-through decoration-dashed opacity-70",
		);
	});
});
