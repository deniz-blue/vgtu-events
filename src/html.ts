const NAMED_ENTITIES: Record<string, string> = {
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	amp: "&",
};

/** WordPress emits numeric entities for typographic punctuation, so both forms appear. */
export const decodeEntities = (value: string): string =>
	value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&(lt|gt|quot|apos|nbsp|amp);/g, (_, name) => NAMED_ENTITIES[name] ?? name);

export const stripTags = (html: string): string =>
	decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();

/**
 * Attribute values reach here in either quote style: EventON's descriptions are
 * rewritten to single quotes so their JSON-LD parses at all.
 */
const attribute = (tag: string, name: string): string | undefined =>
	new RegExp(`\\s${name}=(["'])([^>]*?)\\1`, "i").exec(tag)?.[2];

/**
 * Whitespace at the edges of an inline span belongs outside its markers —
 * CommonMark ignores a padded emphasis marker entirely.
 */
const hoist = (inner: string, wrap: (core: string) => string): string => {
	const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner) ?? [];
	return core ? `${lead}${wrap(core)}${trail}` : `${lead}${trail}`;
};

const emphasise =
	(marker: string) =>
	(_match: string, _tag: string, inner: string): string =>
		hoist(inner, (core) => `${marker}${core}${marker}`);

/**
 * Descriptions arrive as HTML but land in a markdown component, so the structure
 * has to be carried across rather than flattened. Anything with no markdown
 * equivalent falls back to its text.
 */
export const toMarkdown = (html: string): string =>
	decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(?:p|div)>/gi, "\n\n")
			.replace(/<li[^>]*>/gi, "\n- ")
			.replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n\n${"#".repeat(Number(level))} `)
			.replace(/<\/h[1-6]>/gi, "\n\n")
			.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, emphasise("**"))
			.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, emphasise("*"))
			.replace(/<img[^>]*>/gi, (tag) => {
				const source = attribute(tag, "src");
				return source ? `![${attribute(tag, "alt") ?? ""}](${source})` : "";
			})
			.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, (tag, label: string) => {
				const href = attribute(tag, "href");
				return hoist(label, (core) => (href ? `[${core}](${href})` : core));
			})
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Titles and venues come from vilniustech.lt, so they are never trusted as markup. */
export const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
