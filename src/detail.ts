import { decodeEntities, stripTags, toMarkdown } from "./html";

export interface EventDetail {
	/** `HH:MM`, from the header's time range. */
	startTime: string | null;
	endTime: string | null;
	venue: string | null;
	description: string | null;
	registrationUrl: string | null;
}

const HEADER = /<div class="tags-on-blue[^"]*">([\s\S]*?)<\/div>/;
const HEADER_ITEM = /<span>([\s\S]*?)<\/span>/g;
const BODY =
	/<div[^>]*class="[^"]*entry-full[^"]*"[^>]*>([\s\S]*?)(?=<\/div>\s*<\/div>\s*<\/section>)/i;
const TIME_RANGE = /^(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?$/;
const SPOKEN_LANGUAGES = /^(Languages|Kalbos)\s*:/i;
const REGISTRATION =
	/href="(https?:\/\/[^"]*(?:zoom|register|registracij|forms\.|docs\.google)[^"]*)"/i;

/**
 * The header lists date, time, spoken languages and venue as bare spans, in that
 * order but with any of them missing. The venue is the one that is none of the
 * others — a year identifies the date prose in both languages.
 */
const readHeader = (html: string): Pick<EventDetail, "startTime" | "endTime" | "venue"> => {
	const header = HEADER.exec(html)?.[1];
	const result = { startTime: null, endTime: null, venue: null } as {
		startTime: string | null;
		endTime: string | null;
		venue: string | null;
	};
	if (!header) return result;

	for (const [, item] of header.matchAll(HEADER_ITEM)) {
		const text = stripTags(item ?? "");
		const time = TIME_RANGE.exec(text);
		if (time?.[1]) {
			result.startTime = time[1].padStart(5, "0");
			result.endTime = time[2] ? time[2].padStart(5, "0") : null;
		} else if (!/\d{4}/.test(text) && !SPOKEN_LANGUAGES.test(text) && text.length > 3) {
			result.venue = text;
		}
	}

	return result;
};

/** An href arrives HTML-encoded, so a query string reads `&amp;` between its parameters. */
const decodeUrl = (url: string | undefined): string | null => (url ? decodeEntities(url) : null);

export const parseDetail = (html: string): EventDetail => {
	const body = BODY.exec(html)?.[1];
	const description = body ? toMarkdown(body) : null;

	return {
		...readHeader(html),
		description: description && description.length >= 10 ? description : null,
		// Scoped to the article: the site chrome links a registration form on every page.
		registrationUrl: body ? decodeUrl(REGISTRATION.exec(body)?.[1]) : null,
	};
};

export const fetchDetail = async (url: string): Promise<EventDetail> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return parseDetail(await response.text());
};
