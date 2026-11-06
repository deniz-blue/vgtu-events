export const sha256Hex = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return hexOf(new Uint8Array(digest));
};

const hexOf = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

// RFC 9562 section 6.6: the namespace ID for names that are URLs.
const URL_NAMESPACE = "6ba7b8119dad11d180b400c04fd430c8";

/** The RFC 9562 version 5 UUID of a URL, so the same page always gets the same id. */
export const uuidOfUrl = async (url: string): Promise<string> => {
	const namespace = Uint8Array.from(URL_NAMESPACE.match(/../g)!, (pair) => parseInt(pair, 16));
	const name = new TextEncoder().encode(url);
	const input = new Uint8Array(namespace.length + name.length);
	input.set(namespace);
	input.set(name, namespace.length);
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", input)).slice(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = hexOf(bytes);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
