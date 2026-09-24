import { unstable_rethrow } from "next/navigation";

export const UNREACHABLE_MESSAGE =
	"The request did not complete. Check your connection and try again.";

/**
 * Runs a server action and resolves to null when the call itself failed (for
 * example the network dropped), so callers can show an error instead of
 * tripping the error boundary. Next.js redirects still propagate.
 */
export async function reachServer<T>(
	action: () => Promise<T>,
): Promise<T | null> {
	try {
		return await action();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Server action failed", error);
		return null;
	}
}
