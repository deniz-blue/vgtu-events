import type { OpenEvnt } from "@evnt/types";
import { EmojiFormatter, PlainTextFormatter, defaultAnalyzeConfig } from "@evnt/pretty";
import { timeSpanOf } from "./dates";

interface JsonFeedItem {
	id: string;
	url: string;
	title: string;
	content_text: string;
	date_published: string;
	image?: string;
	tags?: string[];
}

export interface JsonFeed {
	version: string;
	title: string;
	home_page_url: string;
	feed_url: string;
	items: JsonFeedItem[];
}

const splashUrl = (event: OpenEvnt): string | undefined => {
	const splash = event.components?.find(
		(component) => component.$type === "directory.evnt.component.splashMedia",
	) as { media?: { sources?: { url?: string }[] } } | undefined;
	return splash?.media?.sources?.[0]?.url;
};

const formatter = new EmojiFormatter({
	...PlainTextFormatter.defaults,
	...EmojiFormatter.emojiDefaults,
	...defaultAnalyzeConfig,
	language: "en",
	timezone: "Europe/Vilnius",
	showLinks: false,
});

export const toJsonFeed = (
	events: { slug: string; event: OpenEvnt }[],
	baseUrl: string,
): JsonFeed => ({
	version: "https://jsonfeed.org/version/1.1",
	title: "VILNIUS TECH Events",
	home_page_url: "https://vilniustech.lt/universitetas/renginiai/",
	feed_url: `${baseUrl}/feed.json`,
	items: events.map(({ slug, event }) => {
		// A PartialDate names a wall time in Vilnius, which is not the UTC reading of it.
		const start = timeSpanOf(event.instances?.[0]?.start);

		return {
			id: slug,
			url: `${baseUrl}/e/${slug}.evnt.json`,
			title: event.name["en"] ?? event.name["lt"] ?? "Untitled Event",
			content_text: formatter.formatEvent(event),
			date_published: new Date(start?.start ?? Date.now()).toISOString(),
			image: splashUrl(event),
		};
	}),
});
