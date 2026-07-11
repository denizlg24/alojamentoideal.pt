"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { SheetClose } from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { signOut, useSession } from "@/lib/auth/client";

/**
 * True only after the first client paint. `useSession` resolves the auth cookie
 * on the client, so the server always renders signed-out; gating the
 * authenticated branch on this avoids a hydration mismatch by deferring it until
 * after hydration.
 */
function useMounted(): boolean {
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	return mounted;
}

function initials(name?: string | null): string {
	if (!name) {
		return "";
	}
	const parts = name.trim().split(/\s+/);
	const first = parts[0]?.[0] ?? "";
	const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
	return (first + last).toUpperCase();
}

/** Header profile control: opens the login overlay when signed out, otherwise
 *  shows an avatar dropdown with the account link and a sign-out action. */
export function UserMenu({ opaque }: { opaque: boolean }) {
	const { data: session, isPending } = useSession();
	const { openAuth } = useAuthDialog();
	const router = useRouter();
	const mounted = useMounted();
	const user = session?.user;
	const authPending = mounted ? isPending : undefined;

	const triggerClasses = cn(
		"rounded-full",
		opaque
			? "text-foreground/80 hover:text-foreground"
			: "text-white hover:bg-white/15 hover:text-white",
	);

	if (!mounted || !user) {
		return (
			<Button
				aria-label="Sign in"
				className={triggerClasses}
				disabled={authPending}
				onClick={() => openAuth({ view: "login" })}
				size="icon"
				variant="ghost"
			>
				<UserRound className="size-5" />
			</Button>
		);
	}

	const handleLogout = async () => {
		await signOut();
		router.refresh();
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Account menu"
					className={triggerClasses}
					size="icon"
					variant="ghost"
				>
					<Avatar className="size-8">
						{user.image && (
							<AvatarImage alt={user.name ?? ""} src={user.image} />
						)}
						<AvatarFallback className="text-xs">
							{initials(user.name) || <UserRound className="size-4" />}
						</AvatarFallback>
					</Avatar>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuLabel className="truncate">
					{user.name || user.email}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/account">Account</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/account/orders">Orders</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/account/bookmarks">Bookmarks</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const MOBILE_ITEM_CLASS =
	"rounded-md px-3 py-2 text-left font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground";

/** Auth entries for the mobile navigation sheet, mirroring {@link UserMenu}. */
export function MobileAuthSection() {
	const { data: session } = useSession();
	const { openAuth } = useAuthDialog();
	const router = useRouter();
	const mounted = useMounted();
	const user = session?.user;

	if (!mounted || !user) {
		return (
			<SheetClose asChild>
				<button
					className={MOBILE_ITEM_CLASS}
					onClick={() => openAuth({ view: "login" })}
					type="button"
				>
					Sign in
				</button>
			</SheetClose>
		);
	}

	const handleLogout = async () => {
		await signOut();
		router.refresh();
	};

	return (
		<>
			<SheetClose asChild>
				<Link className={MOBILE_ITEM_CLASS} href="/account">
					Account
				</Link>
			</SheetClose>
			<SheetClose asChild>
				<Link className={MOBILE_ITEM_CLASS} href="/account/orders">
					Orders
				</Link>
			</SheetClose>
			<SheetClose asChild>
				<Link className={MOBILE_ITEM_CLASS} href="/account/bookmarks">
					Bookmarks
				</Link>
			</SheetClose>
			<SheetClose asChild>
				<button
					className={MOBILE_ITEM_CLASS}
					onClick={handleLogout}
					type="button"
				>
					Log out
				</button>
			</SheetClose>
		</>
	);
}
