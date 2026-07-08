declare module "bun:test" {
	export function describe(name: string, fn: () => void): void;
	export function test(name: string, fn: () => Promise<void> | void): void;
	export const expect: <T>(value: T) => {
		toBe(expected: T): void;
		toBeNull(): void;
		toContain(expected: string): void;
		toEqual(expected: unknown): void;
		toMatchObject(expected: Record<string, unknown>): void;
	};
}
