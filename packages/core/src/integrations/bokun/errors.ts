export interface BokunErrorOptions {
	cause?: unknown;
	requestId?: string;
}

export class BokunError extends Error {
	readonly requestId?: string;

	constructor(message: string, options: BokunErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = new.target.name;
		this.requestId = options.requestId;
	}
}

export class BokunConfigurationError extends BokunError {}

export class BokunTimeoutError extends BokunError {
	readonly retryable = true;
}

export class BokunRequestAbortedError extends BokunError {
	readonly retryable = false;
}

export class BokunNetworkError extends BokunError {
	readonly retryable = true;
}

export class BokunResponseValidationError extends BokunError {
	readonly retryable = false;
}

export class BokunApiError extends BokunError {
	readonly providerMessage?: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(
		message: string,
		status: number,
		options: BokunErrorOptions & { providerMessage?: string } = {},
	) {
		super(message, options);
		this.status = status;
		this.providerMessage = options.providerMessage;
		this.retryable =
			status === 408 ||
			status === 429 ||
			status === 500 ||
			status === 502 ||
			status === 503 ||
			status === 504;
	}
}
