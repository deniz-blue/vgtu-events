import { toOpenEvnt, type EventSources } from "./convert";
import { fetchDetail, type EventDetail } from "./detail";
import { sha256Hex } from "./hash";
import { fetchCards, type EventCard, type Language } from "./listing";
import type { EventEntry, EventIndex, ScrapeFailure } from "./storage";

/**
 * Cloudflare caps subrequests per invocation — 50 on the free plan. The two
 * listing pages name ~45 events between them and each rebuild costs one fetch
 * per language, so a run takes a slice and the cron converges over a few passes.
 */
export const DEFAULT_FETCH_BUDGET = 40;

/**
 * Raise when the converter's output changes. Stored entries carry the revision
 * they were built by, so a bump makes every one of them stale and the cron
 * rewrites the catalogue over the following passes.
 */
export const BUILD = 2;

const FETCH_CONCURRENCY = 6;

export interface EventGroup {
	id: string;
	cards: Partial<Record<Language, EventCard>>;
}

const mapWithConcurrency = async <T, R>(
	items: T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = [];
	let cursor = 0;

	const worker = async (): Promise<void> => {
		while (true) {
			const index = cursor++;
			const item = items[index];
			if (index >= items.length || item === undefined) return;
			results[index] = await run(item);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
};

/** The same upload reused on the same start day, which no two events share. */
const translationKey = (card: EventCard): string | null =>
	card.imageKey ? `${card.imageKey}@${card.dateFrom}` : null;

const countKeys = (cards: EventCard[]): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const card of cards) {
		const key = translationKey(card);
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
};

/**
 * The two listings are independent WordPress posts with no translation link
 * between them — the language switcher on an event page points at the site root.
 * An identical slug is WPML falling back to the post id; otherwise a shared
 * featured image on the same start day identifies the pair, and only where that
 * evidence is unambiguous on both sides. Anything unmatched stays its own event.
 */
export const groupTranslations = (lithuanian: EventCard[], english: EventCard[]): EventGroup[] => {
	const bySlug = new Map(lithuanian.map((card) => [card.slug, card]));
	const lithuanianCounts = countKeys(lithuanian);
	const englishCounts = countKeys(english);

	const byKey = new Map(
		lithuanian
			.filter((card) => lithuanianCounts.get(translationKey(card) ?? "") === 1)
			.map((card) => [translationKey(card)!, card]),
	);

	const groups = new Map<string, EventGroup>(
		lithuanian.map((card) => [card.slug, { id: card.slug, cards: { lt: card } }]),
	);

	for (const card of english) {
		const key = translationKey(card);
		const match =
			bySlug.get(card.slug) ?? (key && englishCounts.get(key) === 1 ? byKey.get(key) : undefined);

		if (match) groups.get(match.slug)!.cards.en = card;
		else groups.set(`en:${card.slug}`, { id: card.slug, cards: { en: card } });
	}

	return [...groups.values()];
};

const languagesIn = (group: EventGroup): Language[] =>
	(Object.keys(group.cards) as Language[]).filter((language) => group.cards[language]);

const sourceHash = (group: EventGroup): Promise<string> =>
	sha256Hex(
		JSON.stringify(
			languagesIn(group)
				.sort()
				.map((language) => group.cards[language]),
		),
	);

type BuildResult =
	| { ok: true; id: string; entry: EventEntry }
	| { ok: false; id: string; reason: string };

const buildEntry = async (group: EventGroup, source: string, now: string): Promise<EventEntry> => {
	const details: EventSources["details"] = {};

	for (const [language, detail] of await mapWithConcurrency(
		languagesIn(group),
		FETCH_CONCURRENCY,
		async (language) => [language, await fetchDetail(group.cards[language]!.url)] as const,
	)) {
		details[language] = detail as EventDetail;
	}

	const data = toOpenEvnt({ cards: group.cards, details });
	if (!data) throw new Error("no usable card");

	return { data, source, build: BUILD, etag: await sha256Hex(JSON.stringify(data)), updated: now };
};

/** Nearest events first, so a cold start fills the landing page before the archive. */
const byRelevance = (today: string) => (a: EventGroup, b: EventGroup) => {
	const dayOf = (group: EventGroup): string =>
		(group.cards.lt ?? group.cards.en)?.dateTo ?? "00000000";
	const [dayA, dayB] = [dayOf(a), dayOf(b)];
	const [pastA, pastB] = [dayA < today, dayB < today];
	if (pastA !== pastB) return pastA ? 1 : -1;
	return pastA ? dayB.localeCompare(dayA) : dayA.localeCompare(dayB);
};

/**
 * Rebuild the stored index. The listing pages decide which events exist; each
 * changed event's own page supplies the time, venue and description that the
 * cards omit.
 */
export const scrape = async (
	previous: EventIndex | null,
	budget: number = DEFAULT_FETCH_BUDGET,
): Promise<EventIndex> => {
	const [lithuanian, english] = await Promise.all([fetchCards("lt"), fetchCards("en")]);
	const groups = groupTranslations(lithuanian, english);
	const now = new Date().toISOString();

	const events: Record<string, EventEntry> = {};
	const stale: { group: EventGroup; source: string }[] = [];

	for (const group of groups) {
		const source = await sourceHash(group);
		const existing = previous?.events[group.id];

		// Keep serving the previous copy until a rebuild succeeds.
		if (existing) events[group.id] = existing;
		if (existing?.source === source && existing.build === BUILD) continue;
		stale.push({ group, source });
	}

	stale.sort((a, b) => byRelevance(now.slice(0, 10).replace(/-/g, ""))(a.group, b.group));

	const targets: typeof stale = [];
	let remaining = budget;
	for (const candidate of stale) {
		const cost = languagesIn(candidate.group).length;
		if (cost > remaining) continue;
		remaining -= cost;
		targets.push(candidate);
	}

	const failures: ScrapeFailure[] = [];
	let built = 0;

	for (const result of await mapWithConcurrency(
		targets,
		FETCH_CONCURRENCY,
		async ({ group, source }): Promise<BuildResult> => {
			try {
				return { ok: true, id: group.id, entry: await buildEntry(group, source, now) };
			} catch (error) {
				return { ok: false, id: group.id, reason: String(error) };
			}
		},
	)) {
		if (result.ok) {
			events[result.id] = result.entry;
			built++;
		} else {
			failures.push({ slug: result.id, reason: result.reason });
		}
	}

	const known = new Set(groups.map((group) => group.id));
	for (const slug of Object.keys(events)) if (!known.has(slug)) delete events[slug];

	return {
		updated: now,
		events,
		stats: {
			listed: groups.length,
			built,
			reused: groups.length - stale.length,
			removed: Object.keys(previous?.events ?? {}).filter((slug) => !known.has(slug)).length,
			pending: stale.length - targets.length,
			bilingual: groups.filter((group) => languagesIn(group).length > 1).length,
			failures,
		},
	};
};
