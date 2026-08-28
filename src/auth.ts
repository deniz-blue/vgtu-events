import { sha256Hex } from "./hash";

/**
 * Digests are compared rather than the tokens themselves. Both are then the same
 * length whatever was offered, and an early mismatch reveals a prefix of the
 * digest rather than of the secret, which is of no use without a preimage.
 */
export const isAuthorised = async (
	header: string | undefined,
	token: string | undefined,
): Promise<boolean> => {
	if (!token) return false;

	const offered = /^Bearer\s+(.+)$/.exec(header ?? "")?.[1];
	if (!offered) return false;

	return (await sha256Hex(offered)) === (await sha256Hex(token));
};
