import "temporal-polyfill-lite/global";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAuthorised } from "./auth";
import { TAGS_COMPONENT_TYPE } from "./convert";
import { eventTimeSpan, type TimeSpan } from "./dates";
import { toJsonFeed } from "./feed";
import { renderPage } from "./page";
import { DEFAULT_FETCH_BUDGET, scrape } from "./scrape";
import { readEvents, writeEvents, type EventEntry } from "./storage";

type Env = {
	EVENTS: KVNamespace;
	/** Bearer token for `POST /scrape`. Unset leaves the route closed. */
	SCRAPE_TOKEN?: string;
};

const EVENT_CONTENT_TYPE = "application/evnt+json";
const INDEX_CONTENT_TYPE = "application/open-evnt-index+json";
const MANIFEST_PATH = "/.well-known/open-evnt/manifest";
const INDEX_PATH = "/index.json";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const PAGE_EVENT_LIMIT = 60;

const COLLECTION_NAME = {
	en: "VILNIUS TECH events",
	lt: "VILNIUS TECH renginiai",
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", exposeHeaders: ["ETag", "Link"] }));

interface ListedEvent {
	slug: string;
	entry: EventEntry;
	span: TimeSpan | null;
}

const spanOf = (entry: EventEntry): TimeSpan | null =>
	eventTimeSpan(
		(entry.data.instances ?? []).map((instance) => instance.start),
		(entry.data.instances ?? []).map((instance) => instance.end),
	);

const listAll = async (kv: KVNamespace) => {
	const stored = await readEvents(kv);
	const listed: ListedEvent[] = Object.entries(stored?.events ?? {}).map(([slug, entry]) => ({
		slug,
		entry,
		span: spanOf(entry),
	}));
	return { stored, listed };
};

/** Stable ordering: chronological, undated events last, slug breaking ties. */
const byStartThenSlug = (a: ListedEvent, b: ListedEvent): number => {
	if (a.span && b.span && a.span.start !== b.span.start) return a.span.start - b.span.start;
	if (!a.span !== !b.span) return a.span ? -1 : 1;
	return a.slug.localeCompare(b.slug);
};

const tagsOf = (entry: EventEntry): string[] => {
	const component = entry.data.components?.find((item) => item.$type === TAGS_COMPONENT_TYPE);
	const tags = component ? (component as { tags?: unknown }).tags : undefined;
	return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
};

/** Lithuanian diacritics are stripped so `ivykis` finds `Įvykis` from an ASCII keyboard. */
const foldForSearch = (value: string): string =>
	value
		.toLocaleLowerCase("lt")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");

const matchesSearch = (listed: ListedEvent, needle: string): boolean =>
	[...Object.values(listed.entry.data.name), ...tagsOf(listed.entry)].some((value) =>
		foldForSearch(value).includes(needle),
	);

app.get("/", async (c) => {
	const { stored, listed } = await listAll(c.env.EVENTS);
	const now = Date.now();

	const upcoming = listed
		.filter((item) => item.span !== null && item.span.end > now)
		.sort(byStartThenSlug)
		.slice(0, PAGE_EVENT_LIMIT)
		.map((item) => ({
			event: { slug: item.slug, entry: item.entry },
			instant: item.span?.start ?? null,
		}));

	return c.html(
		renderPage(new URL(c.req.url).origin, upcoming, listed.length, stored?.updated ?? null),
		200,
		{ Link: `</index.json>; rel="alternate"; type="${INDEX_CONTENT_TYPE}"` },
	);
});

app.get(MANIFEST_PATH, (c) =>
	c.json({
		version: 1,
		name: COLLECTION_NAME,
		items: [
			{
				name: { en: "All events", lt: "Visi renginiai" },
				href: INDEX_PATH,
				type: "directory.evnt.index",
				primary: true,
				auth: "none",
			},
		],
	}),
);

app.get(INDEX_PATH, async (c) => {
	const parseInstant = (value: string | undefined): number | null | undefined => {
		if (value === undefined) return undefined;
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	};

	const after = parseInstant(c.req.query("after"));
	const before = parseInstant(c.req.query("before"));
	if (after === null || before === null) {
		return c.json({ message: "`after` and `before` must be ISO 8601 datetimes" }, 400);
	}

	const rawLimit = Number(c.req.query("limit"));
	const limit =
		Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
	const rawCursor = Number(c.req.query("cursor"));
	const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? rawCursor : 0;
	const search = c.req.query("search");
	const needle = search ? foldForSearch(search) : undefined;

	const { stored, listed: all } = await listAll(c.env.EVENTS);
	let listed = all;

	// `after`/`before` select events overlapping the window; undated events cannot match.
	if (after !== undefined) listed = listed.filter((item) => item.span && item.span.end > after);
	if (before !== undefined) listed = listed.filter((item) => item.span && item.span.start < before);
	if (needle) listed = listed.filter((item) => matchesSearch(item, needle));

	listed.sort(byStartThenSlug);

	const page = listed.slice(cursor, cursor + limit);
	const nextCursor = cursor + limit;
	const nextUrl = new URL(c.req.url);
	nextUrl.searchParams.set("cursor", String(nextCursor));

	return c.json(
		{
			version: 1,
			supports: ["search", "after", "before", "limit"],
			...(stored?.updated ? { updatedAt: stored.updated } : {}),
			total: listed.length,
			items: page.map(({ slug, entry }) => ({
				href: `/e/${slug}.evnt.json`,
				name: entry.data.name,
				updatedAt: entry.updated,
				etag: `"${entry.etag}"`,
			})),
			...(nextCursor < listed.length ? { next: `${nextUrl.pathname}${nextUrl.search}` } : {}),
		},
		200,
		{ "Content-Type": INDEX_CONTENT_TYPE },
	);
});

app.get("/e/:id", async (c) => {
	const slug = c.req.param("id").replace(/\.evnt\.json$/, "");
	if (!slug) return c.notFound();

	const stored = await readEvents(c.env.EVENTS);
	const entry = stored?.events[slug];
	if (!entry) return c.notFound();

	const etag = `"${entry.etag}"`;
	if (c.req.header("If-None-Match") === etag) return c.body(null, 304);

	return c.newResponse(JSON.stringify(entry.data), 200, {
		"Content-Type": EVENT_CONTENT_TYPE,
		ETag: etag,
		"Cache-Control": "public, max-age=3600",
	});
});

app.get("/feed.json", async (c) => {
	const { listed } = await listAll(c.env.EVENTS);
	const feed = toJsonFeed(
		listed.sort(byStartThenSlug).map(({ slug, entry }) => ({ slug, event: entry.data })),
		new URL(c.req.url).origin,
	);
	return c.json(feed, 200, { "Content-Type": "application/feed+json" });
});

app.get("/status", async (c) => {
	const stored = await readEvents(c.env.EVENTS);
	return c.json({
		updated: stored?.updated ?? null,
		events: Object.keys(stored?.events ?? {}).length,
		stats: stored?.stats ?? null,
	});
});

app.post("/scrape", async (c) => {
	if (!(await isAuthorised(c.req.header("Authorization"), c.env.SCRAPE_TOKEN))) {
		return c.json({ message: "A scrape needs a bearer token." }, 401, {
			"WWW-Authenticate": 'Bearer realm="scrape"',
		});
	}

	const requested = Number(c.req.query("limit"));
	const budget = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_FETCH_BUDGET;

	try {
		const data = await scrape(await readEvents(c.env.EVENTS), budget);
		await writeEvents(c.env.EVENTS, data);
		return c.json({ ok: true, updated: data.updated, stats: data.stats });
	} catch (error) {
		return c.json({ ok: false, error: String(error) }, 500);
	}
});

const scheduled: ExportedHandlerScheduledHandler<Env> = async (_controller, env) => {
	try {
		const data = await scrape(await readEvents(env.EVENTS));
		await writeEvents(env.EVENTS, data);
		console.log(`Scrape complete: ${JSON.stringify(data.stats)}`);
	} catch (error) {
		console.error("Scrape failed:", error);
	}
};

export default {
	fetch: app.fetch,
	scheduled,
};
