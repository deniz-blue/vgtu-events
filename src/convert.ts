import { EventBuilder } from "@evnt/builder";
import { PartialDateUtil } from "@evnt/partial-date";
import type { OpenEvnt, PartialDate } from "@evnt/types";
import type { EventCard, Language } from "./listing";
import type { EventDetail } from "./detail";

export const TAGS_COMPONENT_TYPE = "lt.vilniustech.component.categories";

const TIMEZONE = "Europe/Vilnius";
const VENUE_ID = "vilniustech:0";

/** An event as it exists in each language the site publishes it in. */
export interface EventSources {
	cards: Partial<Record<Language, EventCard>>;
	details: Partial<Record<Language, EventDetail>>;
}

/** `YYYYMMDD` plus an optional `HH:MM`, both as the site writes them. */
const toPartialDate = (day: string, time: string | null): PartialDate => {
	const fields = {
		year: Number(day.slice(0, 4)),
		month: Number(day.slice(4, 6)),
		day: Number(day.slice(6, 8)),
		timezone: TIMEZONE,
	};

	if (!time) return PartialDateUtil.format({ ...fields, precision: "day" });

	const [hour, minute] = time.split(":");
	return PartialDateUtil.format({
		...fields,
		hour: Number(hour),
		minute: Number(minute),
		precision: "time",
	});
};

const languagesOf = <T>(record: Partial<Record<Language, T>>): [Language, T][] =>
	Object.entries(record).filter((entry): entry is [Language, T] => entry[1] !== undefined);

export const toOpenEvnt = ({ cards, details }: EventSources): OpenEvnt | null => {
	const primary = cards.lt ?? cards.en;
	if (!primary) return null;

	const builder = new EventBuilder();

	for (const [language, card] of languagesOf(cards)) builder.setName(card.title, language);

	const venueNames = languagesOf(details).filter(([, detail]) => detail.venue);
	if (venueNames.length > 0) {
		builder.addUnknownVenue((venue) => {
			venue.setId(VENUE_ID);
			for (const [language, detail] of venueNames) venue.setName(detail.venue!, language);
			return venue;
		});
	}

	// The header's time range describes the first and last day, not every day between.
	const times = details.lt ?? details.en;
	const start = toPartialDate(primary.dateFrom, times?.startTime ?? null);
	const end =
		primary.dateFrom === primary.dateTo && !times?.endTime
			? undefined
			: toPartialDate(primary.dateTo, times?.endTime ?? times?.startTime ?? null);

	builder.addInstance((instance) => {
		instance.setStart(start);
		if (end) instance.setEnd(end);
		if (venueNames.length > 0) instance.addAllVenues();
		return instance;
	});

	if (primary.imageUrl) {
		const alt = Object.fromEntries(
			languagesOf(cards)
				.filter(([, card]) => card.imageAlt)
				.map(([language, card]) => [language, card.imageAlt!]),
		);
		builder.addCustomComponent({
			$type: "directory.evnt.component.splashMedia",
			roles: ["banner", "background"],
			media: {
				sources: [{ url: primary.imageUrl }],
				...(Object.keys(alt).length > 0 ? { alt } : {}),
			},
		});
	}

	for (const [language, detail] of languagesOf(details)) {
		if (!detail.description) continue;
		builder.addCustomComponent({
			$type: "directory.evnt.richtext.markdown",
			content: detail.description,
			language,
		});
	}

	builder.addCustomComponent({ $type: "directory.evnt.component.source", url: primary.url });

	for (const [language, card] of languagesOf(cards)) {
		if (card.url !== primary.url)
			builder.addLink((link) => link.setUrl(card.url).setName(card.title, language));
	}

	const registration = languagesOf(details).find(([, detail]) => detail.registrationUrl);
	if (registration) {
		builder.addLink((link) =>
			link
				.setUrl(registration[1].registrationUrl!)
				.setName("Registration", "en")
				.setName("Registracija", "lt"),
		);
	}

	// The site exposes its taxonomy only as filter slugs, which no core component covers.
	const categories = [...new Set(languagesOf(cards).flatMap(([, card]) => card.categories))];
	if (categories.length > 0) {
		builder.addCustomComponent({ $type: TAGS_COMPONENT_TYPE, tags: categories });
	}

	return builder.build();
};
