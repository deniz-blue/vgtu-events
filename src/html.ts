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
