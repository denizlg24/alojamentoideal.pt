export type CacheOutcome = "bypass" | "hit" | "miss" | "unavailable";

export interface JsonCacheClient {
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		mode: "EX",
		duration: number,
	): Promise<unknown>;
}

export interface CacheReadThroughResult<T> {
	outcome: CacheOutcome;
	value: T;
}

export async function readThroughJsonCache<T>(
	redis: JsonCacheClient,
	key: string,
	ttlSeconds: number,
	forceFresh: boolean,
	load: () => Promise<T>,
): Promise<CacheReadThroughResult<T>> {
	if (forceFresh || ttlSeconds <= 0) {
		return { outcome: "bypass", value: await load() };
	}

	try {
		const cached = await redis.get(key);
		if (cached) {
			return { outcome: "hit", value: JSON.parse(cached) as T };
		}
	} catch {
		return { outcome: "unavailable", value: await load() };
	}

	const value = await load();

	try {
		await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
	} catch {
		return { outcome: "unavailable", value };
	}

	return { outcome: "miss", value };
}
