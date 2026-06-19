import Image from "next/image";
import Link from "next/link";
import livroReclamacoes from "@/public/livro-reclamacoes.png";

const FOOTER_COLUMNS = [
	{
		heading: "Explore",
		links: [
			{ href: "/homes", label: "Homes" },
			{ href: "/activities", label: "Activities" },
		],
	},
	{
		heading: "Company",
		links: [
			{ href: "/about", label: "About Us" },
			{ href: "/owner", label: "I'm a property owner" },
		],
	},
	{
		heading: "Support",
		links: [
			{ href: "/faq", label: "FAQ" },
			{ href: "/help", label: "Help" },
		],
	},
] as const;

const LEGAL_LINKS = [
	{ href: "/legal/privacy", label: "Privacy Policy" },
	{ href: "/legal/terms", label: "Terms & Conditions" },
	{ href: "/legal/data-protection", label: "Data Protection" },
	{ href: "/legal/cookies", label: "Cookie Policy" },
] as const;

const CURRENT_YEAR = new Date().getFullYear();

export function SiteFooter() {
	return (
		<footer className="mt-auto border-t bg-muted/30">
			<div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
				<div className="flex flex-col gap-3">
					<p className="font-semibold tracking-tight">Alojamento Ideal</p>
					<p className="max-w-xs text-muted-foreground text-sm">
						Cozy, modern apartments along Portugal's North Coast, from Porto to
						Póvoa de Varzim, Leça da Palmeira and Canidelo.
					</p>
				</div>

				{FOOTER_COLUMNS.map((column) => (
					<nav key={column.heading} className="flex flex-col gap-3 text-sm">
						<p className="font-semibold text-foreground">{column.heading}</p>
						{column.links.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="text-muted-foreground transition-colors hover:text-foreground"
							>
								{link.label}
							</Link>
						))}
					</nav>
				))}
			</div>

			<div className="border-t">
				<div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
					<div className="flex flex-col gap-3">
						<nav className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-sm">
							{LEGAL_LINKS.map((link) => (
								<Link
									key={link.href}
									href={link.href}
									className="transition-colors hover:text-foreground"
								>
									{link.label}
								</Link>
							))}
						</nav>
						<p className="text-muted-foreground text-sm">
							© {CURRENT_YEAR} Alojamento Ideal. All rights reserved.
						</p>
					</div>

					<a
						href="https://www.livroreclamacoes.pt"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Livro de Reclamações (opens in a new tab)"
						className="shrink-0"
					>
						<Image
							src={livroReclamacoes}
							alt="Livro de Reclamações"
							className="h-auto w-[135px] max-w-full"
						/>
					</a>
				</div>
			</div>
		</footer>
	);
}
