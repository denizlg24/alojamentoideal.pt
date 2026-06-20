"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { KeyRound, Menu, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import logo from "@/public/alojamento-ideal-logo.png";

const NAV_ITEMS = [
	{ href: "/homes", label: "Homes" },
	{ href: "/activities", label: "Activities" },
	{ href: "/about", label: "About Us" },
	{ href: "/faq", label: "FAQ" },
	{ href: "/help", label: "Help" },
] as const;

export function SiteHeader() {
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-50 transition-colors duration-300",
				scrolled ? "bg-background shadow-sm" : "bg-transparent",
			)}
		>
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
				<Link href="/" aria-label="Alojamento Ideal — home">
					<Image
						src={logo}
						alt="Alojamento Ideal"
						priority
						className="h-10 w-auto rounded shadow-sm"
					/>
				</Link>

				<nav className="hidden items-center gap-1 md:flex">
					{NAV_ITEMS.map((item) => (
						<Button
							key={item.href}
							asChild
							variant="ghost"
							size="sm"
							className={cn(
								"font-medium",
								scrolled
									? "text-foreground/80 hover:text-foreground"
									: "text-white/90 hover:bg-white/15 hover:text-white",
							)}
						>
							<Link href={item.href}>{item.label}</Link>
						</Button>
					))}

					<Button asChild size="sm" className="ml-2 rounded-full">
						<Link href="/owner">
							<KeyRound className="size-4" />
							I&apos;m a property owner
						</Link>
					</Button>

					<Button
						asChild
						variant="ghost"
						size="icon"
						className={cn(
							"rounded-full",
							scrolled
								? "text-foreground/80 hover:text-foreground"
								: "text-white hover:bg-white/15 hover:text-white",
						)}
					>
						<Link href="/sign-in" aria-label="Sign in">
							<UserRound className="size-5" />
						</Link>
					</Button>
				</nav>

				<Sheet>
					<SheetTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Open menu"
							className={cn(
								"rounded-full md:hidden",
								scrolled
									? "text-foreground hover:text-foreground"
									: "text-white hover:bg-white/15 hover:text-white",
							)}
						>
							<Menu className="size-5" />
						</Button>
					</SheetTrigger>
					<SheetContent side="right" className="w-72">
						<SheetHeader>
							<SheetTitle>Menu</SheetTitle>
						</SheetHeader>
						<nav className="flex flex-col gap-1 px-2">
							{NAV_ITEMS.map((item) => (
								<SheetClose asChild key={item.href}>
									<Link
										href={item.href}
										className="rounded-md px-3 py-2 font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
									>
										{item.label}
									</Link>
								</SheetClose>
							))}
							<SheetClose asChild>
								<Link
									href="/sign-in"
									className="rounded-md px-3 py-2 font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
								>
									Sign in
								</Link>
							</SheetClose>
							<SheetClose asChild>
								<Button asChild className="mt-2 rounded-full">
									<Link href="/owner">
										<KeyRound className="size-4" />
										I&apos;m a property owner
									</Link>
								</Button>
							</SheetClose>
						</nav>
					</SheetContent>
				</Sheet>
			</div>
		</header>
	);
}
