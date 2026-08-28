# vgtu-events

Cloudflare Worker that scrapes events from [vilniustech.lt](https://vilniustech.lt/universitetas/renginiai/)
and serves them as [Open Evnt](https://evnt.directory) over HTTP.

## Where the data comes from

Two listing pages and, per event, its own page:

| Source | Supplies |
|--------|----------|
| `/universitetas/renginiai/` and `/en/university/events/` | The full catalogue, `data-datefrom`/`data-dateto`, the filter taxonomy and the featured image |
| Each event's own page | The time range, the venue, the description and a registration link |

Everything is parsed out of rendered HTML. The site runs WordPress, but events are
not a REST-exposed post type — `/wp-json/wp/v2/types` does not list one and the
numeric event ids return `rest_post_invalid_id`. The event pages carry only Yoast's
`WebPage`/`Organization` JSON-LD, with no `Event` and no `startDate`, and
`/en/university/events/feed/` is a 20-item post feed whose `pubDate` is the
publication date rather than the event date. So there is no structured source to
prefer, and no `modified` timestamp to detect changes with.

Both listing pages carry their whole catalogue in the markup — `data-show="6"` only
governs how many are revealed — so enumerating costs two requests.

### Pairing the two languages

The Lithuanian listing carries far more events than the English one, and the two
are independent WordPress posts: the language switcher on an event page points at
the site root, and each page advertises only its own `hreflang`. Nothing links a
translation to its original.

Two pieces of evidence are used instead. An identical slug is WPML falling back to
the post id (`/en/university/events/121365/` and `/universitetas/renginiai/121365/`).
Failing that, the same featured image on the same start day identifies a pair — but
only where that is unambiguous on both sides, because a recurring workshop reuses
one image across many dates. Anything unmatched stays its own event, which is the
honest reading: most Lithuanian events have no English version at all.

This is a heuristic. It currently pairs 5 of the 7 English events; the one it misses
is a genuine pair whose two posts were given different featured images.

## Endpoints

| Route | Description |
|-------|-------------|
| `GET /` | Landing page listing upcoming events, each opening through [eventsl.ink](https://eventsl.ink) |
| `GET /.well-known/open-evnt/manifest` | Open Evnt Manifest v1 |
| `GET /index.json` | Open Evnt Index v1 — `application/open-evnt-index+json` |
| `GET /e/{slug}.evnt.json` | Full Open Evnt event — `application/evnt+json`, ETagged |
| `GET /feed.json` | JSON Feed 1.1 |
| `GET /status` | Last scrape timestamp and stats |
| `POST /scrape?limit=N` | Trigger a scrape (no auth) |
| CRON | Scrapes every 6 hours |

### Index query parameters

`supports: ["search", "after", "before", "limit"]`.

- `search` — matches event names and tags, with Lithuanian diacritics folded away so
  `ivykis` finds *Įvykis* from an ASCII keyboard.
- `after` / `before` — ISO 8601 datetimes selecting events that overlap the window.
  Undated events match neither. A malformed value returns `400`.
- `limit` — capped at 200, defaults to 100.

Pagination is by `cursor`; the `next` URL preserves the active filters. Ordering is
chronological with the slug breaking ties, so pages stay stable.

## Scraping

Each run fetches both listings, carries forward every event whose cards hash
unchanged, and rebuilds the rest. A failed rebuild keeps the previously stored copy
and leaves the event stale, so the next run retries it — failures are counted and
reported by `/status` rather than silently skipped.

Cloudflare caps subrequests per invocation (50 on the free plan) and a rebuild costs
one request per language the event is published in, so each run spends at most
`DEFAULT_FETCH_BUDGET` (40) and the cron converges over a few passes. `stats.pending`
reports how many remain. Stale events are rebuilt nearest-first, so a cold start
fills the landing page before the archive.

Because the cards are the only change signal, **an edit confined to an event's body
text is not detected** — it is picked up whenever the card changes for another
reason. There is no `modified_gmt` to do better with.

### Quirks handled

- **Lazy-loaded images.** The card's `src` is a 1×1 data: placeholder and the real
  image is in `data-src`.
- **Variable header spans.** An event page lists date, time, spoken languages and
  venue as bare `<span>`s with any of them missing, so the venue is identified as the
  one that is none of the others — a four-digit year marks the date prose in both
  languages.
- **Times describe the span's ends.** `18:00 - 20:00` on a multi-day event gives the
  start time of the first day and the end time of the last, not a daily recurrence.
- **HTML-encoded hrefs.** A registration link's query string arrives with `&amp;`
  between its parameters.
- Registration links are searched inside the article only; the site chrome links a
  form on every page.

Each event carries an `lt.vilniustech.component.categories` component holding the
listing's filter slugs (`alumni`, `architekturos-fakultetas`, …), which have no
representation in the core Open Evnt component set. The site publishes them as slugs
rather than display names and exposes no lookup for them.

Venues are `directory.evnt.venue.unknown`: the site gives one free-text line mixing
name and address (*Lietuvos architektų sąjunga Vilniaus skyrius, Kalvarijų g. 1,
Vilnius*) that cannot be split reliably.

## Deploy

The KV namespace id in `wrangler.toml` is a placeholder. Create one first:

```bash
pnpm wrangler kv namespace create EVENTS
```

then paste the id into `wrangler.toml` and:

```bash
pnpm install
pnpm deploy
pnpm dev      # local
```

## Stack

- [Hono](https://hono.dev/) on Cloudflare Workers
- `@evnt/builder`, `@evnt/partial-date`, `@evnt/pretty`, `@evnt/types`
- KV — a single `events` key holding the whole index
- wrangler — dev, deploy, CRON
