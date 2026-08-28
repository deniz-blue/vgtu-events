import { PartialDateUtil } from "@evnt/partial-date";
import type { PartialDate } from "@evnt/types";

/** The span of real time a PartialDate covers, as epoch milliseconds. Both bounds are inclusive. */
export interface TimeSpan {
	start: number;
	end: number;
}

export const timeSpanOf = (value: string | undefined): TimeSpan | null => {
	if (!value || !PartialDateUtil.isValid(value)) return null;
	return {
		start: PartialDateUtil.toInstant(value, "low").epochMilliseconds,
		end: PartialDateUtil.toInstant(value, "high").epochMilliseconds,
	};
};

/**
 * The span an event occupies, from its earliest start to its latest known end.
 * Events with no parseable date return null and sort last.
 */
export const eventTimeSpan = (
	starts: (PartialDate | undefined)[],
	ends: (PartialDate | undefined)[],
): TimeSpan | null => {
	const startSpans = starts.map(timeSpanOf).filter((span): span is TimeSpan => span !== null);
	if (startSpans.length === 0) return null;

	const endSpans = ends.map(timeSpanOf).filter((span): span is TimeSpan => span !== null);
	const start = Math.min(...startSpans.map((span) => span.start));
	const end = Math.max(...(endSpans.length > 0 ? endSpans : startSpans).map((span) => span.end));

	return { start, end: Math.max(start, end) };
};
