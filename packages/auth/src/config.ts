const DEV_SECRET = "dev-insecure-better-auth-secret-change-me-0000";
const DEFAULT_EMAIL_FROM = "Alojamento Ideal <no-reply@alojamentoideal.pt>";

export interface GoogleProviderConfig {
	clientId: string;
	clientSecret: string;
}

export interface EmailConfig {
	/** RFC 5322 "from" address used for transactional auth emails. */
	from: string;
	/** When set, transactional emails are sent via Resend; otherwise logged. */
	resendApiKey?: string;
}

export interface AuthConfig {
	baseURL: string;
	email: EmailConfig;
	google?: GoogleProviderConfig;
	secret: string;
	trustedOrigins: string[];
}

interface AuthEnvironment {
	AUTH_TRUSTED_ORIGINS?: string;
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	EMAIL_FROM?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	NODE_ENV?: string;
	RESEND_API_KEY?: string;
}

export function getAuthConfig(
	environment: AuthEnvironment = process.env,
): AuthConfig {
	const isProduction = environment.NODE_ENV === "production";

	const secret = environment.BETTER_AUTH_SECRET;
	if (isProduction && !secret) {
		throw new Error("BETTER_AUTH_SECRET is required in production");
	}

	const baseURL = environment.BETTER_AUTH_URL ?? "http://localhost:3000";

	return {
		baseURL,
		email: emailConfig(environment),
		google: googleProvider(environment),
		secret: secret ?? DEV_SECRET,
		trustedOrigins: parseOrigins(environment.AUTH_TRUSTED_ORIGINS),
	};
}

function emailConfig(environment: AuthEnvironment): EmailConfig {
	const resendApiKey = environment.RESEND_API_KEY?.trim();
	return {
		from: environment.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
		resendApiKey: resendApiKey ? resendApiKey : undefined,
	};
}

function googleProvider(
	environment: AuthEnvironment,
): GoogleProviderConfig | undefined {
	const clientId = environment.GOOGLE_CLIENT_ID;
	const clientSecret = environment.GOOGLE_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		return undefined;
	}

	return { clientId, clientSecret };
}

function parseOrigins(value: string | undefined): string[] {
	if (!value) {
		return [];
	}

	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
}
