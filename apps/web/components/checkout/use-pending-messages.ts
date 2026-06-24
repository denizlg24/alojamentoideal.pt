"use client";

import { useEffect, useState } from "react";

/**
 * Cycles through reassurance copy while a slow async action runs, advancing one
 * message per interval and holding on the last one. Resets when `active` turns
 * false. Pass a stable (module-level) `messages` array to avoid timer churn.
 */
export function usePendingMessages(
	active: boolean,
	messages: readonly string[],
	intervalMs = 4500,
): string {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		if (!active) {
			setIndex(0);
			return;
		}
		if (messages.length <= 1) {
			return;
		}
		const id = window.setInterval(() => {
			setIndex((current) =>
				current + 1 < messages.length ? current + 1 : current,
			);
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [active, messages, intervalMs]);

	return messages[Math.min(index, messages.length - 1)] ?? "";
}
