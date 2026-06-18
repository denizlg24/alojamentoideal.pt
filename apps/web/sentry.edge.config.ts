import * as Sentry from "@sentry/nextjs";

// The Edge runtime only reliably exposes NEXT_PUBLIC_* env at runtime.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

function sampleRate(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
		? parsed
		: fallback;
}

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
	tracesSampleRate: sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
});
