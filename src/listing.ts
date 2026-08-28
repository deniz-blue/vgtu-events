import { decodeEntities, stripTags } from "./html";

export type Language = "en" | "lt";

export const LISTINGS: Record<Language, string> = {
	en: "https://vilniustech.lt/en/university/events/",
	lt: "https://vilniustech.lt/universitetas/renginiai/",
};

export interface EventCard {
	language: Language;
	url: string;
	slug: string;
	title: string;
	/** `YYYYMMDD`, straight from the card's data attributes. */
	dateFrom: string;
	dateTo: string;
	imageUrl: string | null;
	imageAlt: string | null;
	/**
	 * The featured image's original filename. The same upload is reused across an
	 * event's translations, which is the only link between them the site exposes.
	 */
	imageKey: string | null;
	categories: string[];
}

const CARD_START = '<div class="blue-filter-box-content-list-item event-card';
const DATES = /data-datefrom="(\d{8})"\s+data-dateto="(\d{8})"/;
const FILTER = /data-filter1="([^"]*)"/;
const LINK = /<a href="([^"]+)"/;
const TITLE = /class="heading-4[^"]*"[^>]*>([\s\S]*?)<\/div>/;
/** The card ships a 1×1 data: placeholder in `src` and the real image in `data-src`. */
const LAZY_IMAGE = /<img[^>]*\sdata-src="([^"]+)"/;
const EAGER_IMAGE = /<img[^>]*\ssrc="(https?:\/\/[^"]+)"/;
const IMAGE_ALT = /<img[^>]*\salt="([^"]*)"/;

const slugOf = (url: string): string => url.replace(/\/+$/, "").split("/").pop() ?? "";

/** WordPress serves a resized copy per breakpoint; the original names the upload. */
const imageKeyOf = (url: string): string =>
	(url.split("?")[0] ?? "")
		.split("/")
		.pop()
		?.replace(/-\d+x\d+(\.\w+)$/, "$1") ?? "";

export const parseCards = (html: string, language: Language): EventCard[] => {
	const cards: EventCard[] = [];

	for (const block of html.split(CARD_START)) {
		const dates = DATES.exec(block);
		const link = LINK.exec(block);
		if (!dates?.[1] || !dates[2] || !link?.[1]) continue;

		const image = LAZY_IMAGE.exec(block)?.[1] ?? EAGER_IMAGE.exec(block)?.[1] ?? null;
		const alt = IMAGE_ALT.exec(block)?.[1];
		const title = TITLE.exec(block)?.[1];

		cards.push({
			language,
			url: link[1],
			slug: slugOf(link[1]),
			title: title ? stripTags(title) : alt ? decodeEntities(alt) : "Untitled Event",
			dateFrom: dates[1],
			dateTo: dates[2],
			imageUrl: image,
			imageAlt: alt ? decodeEntities(alt) : null,
			imageKey: image ? imageKeyOf(image) : null,
			categories: (FILTER.exec(block)?.[1] ?? "")
				.split(",")
				.map((category) => category.trim())
				.filter(Boolean),
		});
	}

	return cards;
};

export const fetchCards = async (language: Language): Promise<EventCard[]> => {
	const response = await fetch(LISTINGS[language]);
	if (!response.ok) throw new Error(`${LISTINGS[language]} responded ${response.status}`);
	return parseCards(await response.text(), language);
};
