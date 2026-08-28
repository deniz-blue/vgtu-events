import type { Translations } from "@evnt/types";
import { TAGS_COMPONENT_TYPE } from "./convert";
import { escapeHtml } from "./html";
import type { EventEntry } from "./storage";

const EVENTSLINK_BASE = "https://eventsl.ink/e";
const TIMEZONE = "Europe/Vilnius";

export interface PageEvent {
	slug: string;
	entry: EventEntry;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
	timeZone: TIMEZONE,
	day: "numeric",
	month: "short",
	year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
	timeZone: TIMEZONE,
	hour: "2-digit",
	minute: "2-digit",
});

/** Show a clock only where the site gave one — many events are day-precision. */
const formatWhen = (start: string | undefined, instant: number | null): string => {
	if (!start || instant === null) return "Date to be announced";
	const day = dayFormat.format(instant);
	return start.includes("T") ? `${day}, ${timeFormat.format(instant)}` : day;
};

const preferred = (translations: Translations | undefined): string | undefined =>
	translations?.["en"] ?? translations?.["lt"] ?? Object.values(translations ?? {})[0];

const tagsOf = (entry: EventEntry): string[] => {
	const component = entry.data.components?.find((item) => item.$type === TAGS_COMPONENT_TYPE);
	const tags = component ? (component as { tags?: unknown }).tags : undefined;
	return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
};

const renderEvent = (
	origin: string,
	{ slug, entry }: PageEvent,
	instant: number | null,
): string => {
	const eventUrl = `${origin}/e/${slug}.evnt.json`;
	const openUrl = `${EVENTSLINK_BASE}?url=${encodeURIComponent(eventUrl)}`;
	const where = preferred(entry.data.venues?.[0]?.name);
	const tags = tagsOf(entry);
	const languages = Object.keys(entry.data.name).sort().join(" · ").toUpperCase();

	return `<li class="event">
	<div class="when">${escapeHtml(formatWhen(entry.data.instances?.[0]?.start, instant))}</div>
	<div class="what">
		<a class="name" href="${escapeHtml(openUrl)}">${escapeHtml(preferred(entry.data.name) ?? "Untitled")}</a>
		<div class="meta">${where ? escapeHtml(where) : "Venue to be announced"}<span class="langs">${escapeHtml(languages)}</span></div>
		${tags.length > 0 ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
	</div>
	<a class="open" href="${escapeHtml(openUrl)}">Open&nbsp;↗</a>
</li>`;
};

export const renderPage = (
	origin: string,
	events: { event: PageEvent; instant: number | null }[],
	total: number,
	updated: string | null,
): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILNIUS TECH events</title>
<meta name="description" content="Events from vilniustech.lt, served as Open Evnt.">
<link rel="alternate" type="application/open-evnt-index+json" href="/index.json">
<link rel="alternate" type="application/feed+json" href="/feed.json">
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #101418; --muted: #5f6b76; --line: #e2e7ec; --accent: #0057b8; --chip: #eef3f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #101418; --fg: #e8edf2; --muted: #92a0ad; --line: #232c35; --accent: #6ba8ff; --chip: #1a222a; } }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2.5rem 1.25rem 4rem; max-width: 46rem; background: var(--bg); color: var(--fg);
	font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { margin: 0 0 .35rem; font-size: 1.6rem; letter-spacing: -.02em; }
a { color: var(--accent); }
.lede { margin: 0 0 1.75rem; color: var(--muted); }
ul { list-style: none; margin: 0; padding: 0; }
.event { display: grid; grid-template-columns: 9.5rem 1fr auto; gap: 1rem; align-items: center;
	padding: .85rem 0; border-top: 1px solid var(--line); }
.when { color: var(--muted); font-size: .85rem; font-variant-numeric: tabular-nums; }
.name { font-weight: 600; text-decoration: none; }
.name:hover { text-decoration: underline; }
.meta { color: var(--muted); font-size: .85rem; }
.langs { margin-left: .5rem; font-size: .72rem; letter-spacing: .04em; opacity: .75; }
.tags { margin-top: .3rem; display: flex; flex-wrap: wrap; gap: .3rem; }
.tags span { background: var(--chip); color: var(--muted); border-radius: 999px; padding: .1rem .5rem; font-size: .72rem; }
.open { white-space: nowrap; font-size: .85rem; text-decoration: none; border: 1px solid var(--line);
	border-radius: 999px; padding: .3rem .7rem; }
.open:hover { border-color: var(--accent); }
footer { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .85rem; }
footer code { background: var(--chip); border-radius: 4px; padding: .1rem .35rem; font-size: .85em; }
@media (max-width: 34rem) {
	.event { grid-template-columns: 1fr auto; }
	.when { grid-column: 1 / -1; }
}
</style>
</head>
<body>
<h1>VILNIUS TECH events</h1>
<p class="lede">Scraped from <a href="https://vilniustech.lt/universitetas/renginiai/">vilniustech.lt</a> and served as
<a href="https://evnt.directory">Open Evnt</a>. Pick an event to open it in a compatible app.</p>
<ul>
${events.map(({ event, instant }) => renderEvent(origin, event, instant)).join("\n")}
</ul>
<footer>
<p>${events.length} upcoming of ${total} events${updated ? `, last checked ${escapeHtml(updated.slice(0, 16).replace("T", " "))} UTC` : ""}.</p>
<p>For apps and tools: <a href="/index.json">/index.json</a> is an Open Evnt Index,
<a href="/.well-known/open-evnt/manifest">the manifest</a> lists what is served, each event is at
<code>/e/{slug}.evnt.json</code>, and <a href="/feed.json">/feed.json</a> is a JSON Feed.</p>
</footer>
</body>
</html>`;
