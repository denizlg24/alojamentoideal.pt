import Image from "next/image";
import Link from "next/link";
import illustration from "@/public/404_illustration.svg";

const HELPFUL_LINKS = [
	{ href: "/", label: "Homepage" },
	{ href: "/homes", label: "Homes" },
	{ href: "/activities", label: "Activities" },
] as const;

export default function NotFound() {
	return (
		<main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 sm:px-6">
			<div className="my-12 flex w-full max-w-4xl flex-col items-center gap-8 md:my-20 md:grid md:grid-cols-3 md:gap-6">
				<div className="flex w-full flex-col items-center gap-4 text-center md:col-span-2 md:items-start md:text-left">
					<h1 className="font-bold text-4xl tracking-tight sm:text-5xl">
						Oops!
					</h1>
					<h2 className="text-muted-foreground text-xl">
						We can't seem to find the page you're looking for.
					</h2>
					<p className="text-muted-foreground text-sm">Error code: 404</p>
					<div className="mt-2 flex flex-col gap-1 text-sm">
						<p className="font-medium">Here are some helpful links instead:</p>
						{HELPFUL_LINKS.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="text-primary transition-colors hover:underline"
							>
								{link.label}
							</Link>
						))}
					</div>
				</div>
				<div className="w-full max-w-xs md:col-span-1 md:max-w-none">
					<Image
						src={illustration}
						alt="Page not found illustration"
						priority
						className="h-auto w-full"
					/>
				</div>
			</div>
		</main>
	);
}
