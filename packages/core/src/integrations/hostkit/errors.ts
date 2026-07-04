export interface HostkitErrorOptions {
	cause?: unknown;
	requestId?: string;
}

export class HostkitError extends Error {
	readonly requestId?: string;

	constructor(message: string, options: HostkitErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = new.target.name;
		this.requestId = options.requestId;
	}
}

export class HostkitConfigurationError extends HostkitError {}

export class HostkitTimeoutError extends HostkitError {
	readonly retryable = true;
}

export class HostkitRequestAbortedError extends HostkitError {
	readonly retryable = false;
}

export class HostkitNetworkError extends HostkitError {
	readonly retryable = true;
}

/** A single zod validation failure, flattened for PII-safe logging. */
export interface HostkitResponseValidationIssue {
	code: string;
	message: string;
	/** Dot-joined path to the failing field, or `(root)` for the envelope. */
	path: string;
}

export class HostkitResponseValidationError extends HostkitError {
	readonly retryable = false;
	/** Per-field zod failures pinpointing why the response did not parse. */
	readonly issues: HostkitResponseValidationIssue[];
	/**
	 * PII-safe skeleton of the actual response (keys mapped to value types, no
	 * values), so the real provider shape can be recovered from logs without
	 * leaking guest or invoice data.
	 */
	readonly responseShape?: string;

	constructor(
		message: string,
		options: HostkitErrorOptions & {
			issues?: HostkitResponseValidationIssue[];
			responseShape?: string;
		} = {},
	) {
		super(message, options);
		this.issues = options.issues ?? [];
		this.responseShape = options.responseShape;
	}
}

/**
 * Hostkit reports most failures as an `error` message in a 200 body rather
 * than an HTTP status, so retryability considers both the status code and the
 * documented provider messages ("Limit exceeded", "Internal error").
 */
export class HostkitApiError extends HostkitError {
	readonly providerMessage?: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(
		message: string,
		status: number,
		options: HostkitErrorOptions & { providerMessage?: string } = {},
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
			status === 504 ||
			isRetryableProviderMessage(options.providerMessage);
	}
}

function isRetryableProviderMessage(message: string | undefined): boolean {
	if (!message) {
		return false;
	}
	return /limit exceeded|internal error/i.test(message);
}
