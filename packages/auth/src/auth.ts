import type { auth as runtimeAuth } from "./runtime.js";

export type Auth = typeof runtimeAuth;
export type Session = Auth["$Infer"]["Session"];
export type AuthUser = Session["user"];

let authPromise: Promise<Auth> | undefined;

export function getAuth(): Promise<Auth> {
	authPromise ??= import("./runtime.js").then(({ auth }) => auth);

	return authPromise;
}

const authApi = new Proxy({} as Auth["api"], {
	get(_target, property) {
		return async (...args: unknown[]) => {
			const auth = await getAuth();
			const value = Reflect.get(auth.api, property);

			if (typeof value !== "function") {
				return value;
			}

			return value.apply(auth.api, args);
		};
	},
});

export const auth = new Proxy({} as Auth, {
	get(_target, property) {
		if (property === "api") {
			return authApi;
		}

		return async (...args: unknown[]) => {
			const auth = await getAuth();
			const value = Reflect.get(auth, property);

			if (typeof value !== "function") {
				return value;
			}

			return value.apply(auth, args);
		};
	},
});
