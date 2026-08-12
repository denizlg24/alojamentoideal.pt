/**
 * Drizzle query primitives for consumers of the workspace database package.
 *
 * Keeping schema objects and SQL builders behind the same package boundary
 * prevents nominal type conflicts when a package manager installs multiple
 * peer-resolution variants of Drizzle.
 */
export {
	and,
	arrayContains,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	min,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
export type { AnyPgColumn } from "drizzle-orm/pg-core";
