import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function sampleRate(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
		? parsed
		: fallback;
}

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment:
		process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
	tracesSampleRate: sampleRate(
		process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
		0.1,
	),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
