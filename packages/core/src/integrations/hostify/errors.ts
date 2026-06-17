export interface HostifyErrorOptions {
	cause?: unknown;
	requestId?: string;
}

export class HostifyError extends Error {
	readonly requestId?: string;

	constructor(message: string, options: HostifyErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = new.target.name;
		this.requestId = options.requestId;
	}
}

export class HostifyConfigurationError extends HostifyError {}

export class HostifyTimeoutError extends HostifyError {
	readonly retryable = true;
}

export class HostifyRequestAbortedError extends HostifyError {
	readonly retryable = false;
}

export class HostifyNetworkError extends HostifyError {
	readonly retryable = true;
}

export class HostifyResponseValidationError extends HostifyError {
	readonly retryable = false;
}

export class HostifyApiError extends HostifyError {
	readonly providerMessage?: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(
		message: string,
		status: number,
		options: HostifyErrorOptions & { providerMessage?: string } = {},
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
