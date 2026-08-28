import type { OpenEvnt } from "@evnt/types";

export interface EventEntry {
	data: OpenEvnt;
	/**
	 * Hash of the listing cards this entry was built from. The site exposes no
	 * modification time, so this is the only change signal available — an edit
	 * confined to the event's body text will not show up in it.
	 */
	source: string;
	/** Converter revision this entry was produced by; a bump rebuilds every stored event. */
	build: number;
	/** SHA-256 of the serialised event, computed once so the index and the event route agree. */
	etag: string;
	updated: string;
}

export interface ScrapeFailure {
	slug: string;
	reason: string;
}

export interface ScrapeStats {
	/** Events the listing pages name — the real size of the catalogue. */
	listed: number;
	/** Rebuilt from their own pages this run. */
	built: number;
	/** Unchanged since the last run and carried forward. */
	reused: number;
	/** Dropped because the listings no longer name them. */
	removed: number;
	/** Changed but deferred past this run's fetch budget. */
	pending: number;
	/** Events published in both Lithuanian and English. */
	bilingual: number;
	failures: ScrapeFailure[];
}

export interface EventIndex {
	updated: string;
	events: Record<string, EventEntry>;
	stats?: ScrapeStats;
}

export const readEvents = async (kv: KVNamespace): Promise<EventIndex | null> => {
	const raw = await kv.get("events");
	return raw ? (JSON.parse(raw) as EventIndex) : null;
};

export const writeEvents = async (kv: KVNamespace, data: EventIndex): Promise<void> => {
	await kv.put("events", JSON.stringify(data));
};
