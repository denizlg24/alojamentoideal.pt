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

/** A single zod validation failure, flattened for PII-safe logging. */
export interface HostifyResponseValidationIssue {
	code: string;
	message: string;
	/** Dot-joined path to the failing field, or `(root)` for the envelope. */
	path: string;
}

export class HostifyResponseValidationError extends HostifyError {
	readonly retryable = false;
	/** Per-field zod failures pinpointing why the response did not parse. */
	readonly issues: HostifyResponseValidationIssue[];
	/**
	 * PII-safe skeleton of the actual response (keys mapped to value types, no
	 * values), so the real provider shape can be recovered from logs without
	 * leaking guest data.
	 */
	readonly responseShape?: string;

	constructor(
		message: string,
		options: HostifyErrorOptions & {
			issues?: HostifyResponseValidationIssue[];
			responseShape?: string;
		} = {},
	) {
		super(message, options);
		this.issues = options.issues ?? [];
		this.responseShape = options.responseShape;
	}
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
