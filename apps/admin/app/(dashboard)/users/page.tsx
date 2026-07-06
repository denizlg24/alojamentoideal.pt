import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { requireAdminUser } from "@/lib/auth/admin";
import { getAdminAuth } from "@/lib/auth/server";
import { formatDateTime } from "@/lib/format";
import { UserRowControls } from "./user-actions";
import { UsersFilters } from "./users-filters";

export const metadata: Metadata = { title: "Users" };

const USERS_PAGE_SIZE = 25;

interface UsersPageProps {
	searchParams: Promise<{ page?: string; q?: string }>;
}

function pageHref(query: string | null, page: number): string {
	const search = new URLSearchParams();
	if (query) {
		search.set("q", query);
	}
	if (page > 0) {
		search.set("page", String(page));
	}
	const value = search.toString();
	return value ? `/users?${value}` : "/users";
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
	const [currentAdmin, params, requestHeaders] = await Promise.all([
		requireAdminUser(),
		searchParams,
		headers(),
	]);
	const query = params.q?.trim() || null;
	const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

	const result = await getAdminAuth().api.listUsers({
		headers: requestHeaders,
		query: {
			limit: USERS_PAGE_SIZE,
			offset: page * USERS_PAGE_SIZE,
			sortBy: "createdAt",
			sortDirection: "desc",
			...(query
				? {
						searchField: "email" as const,
						searchOperator: "contains" as const,
						searchValue: query,
					}
				: {}),
		},
	});

	const total = result.total;
	const hasNext = (page + 1) * USERS_PAGE_SIZE < total;

	return (
		<div className="mx-auto max-w-5xl">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Users
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						{total} accounts. Admins have full access to this dashboard.
					</p>
				</div>
				<UsersFilters />
			</div>

			<Table className="mt-6">
				<TableHeader>
					<TableRow>
						<TableHead>Email</TableHead>
						<TableHead>Name</TableHead>
						<TableHead>Created</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="w-14" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{result.users.length === 0 ? (
						<TableRow>
							<TableCell
								className="py-10 text-center text-muted-foreground"
								colSpan={6}
							>
								No users match this search.
							</TableCell>
						</TableRow>
					) : (
						result.users.map((user) => (
							<TableRow key={user.id}>
								<TableCell className="font-medium">
									{user.email}
									{user.id === currentAdmin.id ? (
										<span className="ml-1.5 text-muted-foreground text-xs">
											(you)
										</span>
									) : null}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{user.name || "—"}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatDateTime(user.createdAt)}
								</TableCell>
								<UserRowControls
									banned={Boolean(user.banned)}
									email={user.email}
									isSelf={user.id === currentAdmin.id}
									role={user.role ?? "user"}
									userId={user.id}
								/>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>

			<div className="mt-4 flex items-center justify-end gap-2">
				<Button asChild size="sm" variant="ghost">
					<Link
						aria-disabled={page === 0}
						className={page === 0 ? "pointer-events-none opacity-40" : ""}
						href={pageHref(query, page - 1)}
					>
						Previous
					</Link>
				</Button>
				<Button asChild size="sm" variant="ghost">
					<Link
						aria-disabled={!hasNext}
						className={hasNext ? "" : "pointer-events-none opacity-40"}
						href={pageHref(query, page + 1)}
					>
						Next
					</Link>
				</Button>
			</div>
		</div>
	);
}
