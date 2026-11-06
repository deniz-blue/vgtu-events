import { EventBuilder } from "@evnt/builder";
import { PartialDate, type PartialDateString } from "@evnt/partial-date";
import type { OpenEvnt, Translations } from "@evnt/types";
import type { EventCard, Language } from "./listing";
import type { EventDetail } from "./detail";

export const TAGS_COMPONENT_TYPE = "lt.vilniustech.component.categories#0";

const TIMEZONE = "Europe/Vilnius";

/** An event as it exists in each language the site publishes it in. */
export interface EventSources {
	cards: Partial<Record<Language, EventCard>>;
	details: Partial<Record<Language, EventDetail>>;
}

/** `YYYYMMDD` plus an optional `HH:MM`, both as the site writes them. */
const toPartialDate = (day: string, time: string | null): PartialDateString => {
	const year = Number(day.slice(0, 4));
	const month = Number(day.slice(4, 6));
	const date = Number(day.slice(6, 8));
	if (!time) return new PartialDate.Day(year, month, date, TIMEZONE).toString();

	const [hour, minute] = time.split(":");
	return new PartialDate.Time(year, month, date, Number(hour), Number(minute), TIMEZONE).toString();
};

const languagesOf = <T>(record: Partial<Record<Language, T>>): [Language, T][] =>
	Object.entries(record).filter((entry): entry is [Language, T] => entry[1] !== undefined);

export const primaryCardOf = ({ cards }: EventSources): EventCard | undefined =>
	cards.lt ?? cards.en;

const translationsOf = <T>(
	record: Partial<Record<Language, T>>,
	text: (value: T) => string | null | undefined,
): Translations =>
	Object.fromEntries(
		languagesOf(record).flatMap(([language, value]) => {
			const content = text(value);
			return content ? [[language, content]] : [];
		}),
	);

export const toOpenEvnt = (sources: EventSources, id: string): OpenEvnt | null => {
	const { cards, details } = sources;
	const primary = primaryCardOf(sources);
	if (!primary) return null;

	const builder = new EventBuilder().setId(id);

	for (const [language, card] of languagesOf(cards)) builder.setName(card.title, language);

	const venueName = translationsOf(details, (detail) => detail.venue);
	if (Object.keys(venueName).length > 0) builder.setVenue({ name: venueName });

	// The header's time range describes the first and last day, not every day between.
	const times = details.lt ?? details.en;
	const start = toPartialDate(primary.dateFrom, times?.startTime ?? null);
	const end =
		primary.dateFrom === primary.dateTo && !times?.endTime
			? undefined
			: toPartialDate(primary.dateTo, times?.endTime ?? times?.startTime ?? null);

	builder.addOccurrence(end ? { start, end } : { start });

	const spokenLanguages = times?.spokenLanguages ?? [];
	if (spokenLanguages.length > 0) {
		builder.addCustomComponent({
			$type: "directory.evnt.component.languages#0",
			languages: spokenLanguages.map((code) => ({ code })),
		});
	}

	if (primary.imageUrl) {
		const alt = translationsOf(cards, (card) => card.imageAlt);
		builder.addCustomComponent({
			$type: "directory.evnt.component.splashMedia#0",
			roles: ["banner", "background"],
			media: {
				sources: [{ url: primary.imageUrl }],
				...(Object.keys(alt).length > 0 ? { alt } : {}),
			},
		});
	}

	const description = translationsOf(details, (detail) => detail.description);
	if (Object.keys(description).length > 0) {
		builder.addCustomComponent({ $type: "directory.evnt.text.markdown#0", content: description });
	}

	builder.addCustomComponent({ $type: "directory.evnt.component.source#0", url: primary.url });

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
