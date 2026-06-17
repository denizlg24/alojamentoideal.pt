export interface ApiConfig {
	port: number;
}

export function getApiConfig(environment = process.env): ApiConfig {
	const rawPort = environment.PORT ?? "3000";
	const port = Number(rawPort);

	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid PORT value: ${rawPort}`);
	}

	return { port };
}
