declare module "bun:test" {
	export function describe(name: string, run: () => void): void;
	export function test(name: string, run: () => void | Promise<void>): void;
	export const mock: {
		module(path: string, factory: () => Record<string, unknown>): void;
	};
	export function expect<T>(value: T): {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
	};
}
