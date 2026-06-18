import { optionalString } from "../internal/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	child(bindings: Record<string, unknown>): Logger;
	debug(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
	debug: 10,
	error: 40,
	info: 20,
	warn: 30,
};

function resolveThreshold(): number {
	const configured = optionalString(process.env.LOG_LEVEL)?.toLowerCase();
	if (configured && configured in LEVEL_WEIGHT) {
		return LEVEL_WEIGHT[configured as LogLevel];
	}

	return LEVEL_WEIGHT.info;
}

function emit(
	level: LogLevel,
	message: string,
	bindings: Record<string, unknown>,
	fields?: Record<string, unknown>,
): void {
	if (LEVEL_WEIGHT[level] < resolveThreshold()) {
		return;
	}

	const line = JSON.stringify({
		level,
		message,
		time: new Date().toISOString(),
		...bindings,
		...fields,
	});

	if (level === "error") {
		console.error(line);
	} else {
		console.log(line);
	}
}

function build(bindings: Record<string, unknown>): Logger {
	return {
		child(extra) {
			return build({ ...bindings, ...extra });
		},
		debug(message, fields) {
			emit("debug", message, bindings, fields);
		},
		error(message, fields) {
			emit("error", message, bindings, fields);
		},
		info(message, fields) {
			emit("info", message, bindings, fields);
		},
		warn(message, fields) {
			emit("warn", message, bindings, fields);
		},
	};
}

export function createLogger(scope?: string): Logger {
	return build(scope ? { scope } : {});
}

export const logger = createLogger();
