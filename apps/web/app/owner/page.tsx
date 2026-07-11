import { ArrowRight, Check, MapPin, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { OwnerContactForm } from "@/components/owner/owner-contact-form";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPageMetadata({
	title: "I’m a property owner",
	description:
		"Talk to Alojamento Ideal about managing your property on Portugal's North Coast.",
	path: "/owner",
	image: "/about-living-room.jpg",
	keywords: [
		"property management Porto",
		"holiday rental management Portugal",
		"property owner North Coast Portugal",
		"Alojamento Ideal property management",
	],
});

const BENEFITS = [
	"A considered approach to every property",
	"Local knowledge from Porto to the coast",
	"Clear communication and thoughtful care",
] as const;

export default function OwnerPage() {
	return (
		<div className="min-h-screen bg-[#f8f5ef] text-[#2e2925]">
			<SiteHeader solid />

			<main>
				<section className="mx-auto grid w-full max-w-6xl gap-14 px-4 pt-28 pb-20 sm:px-6 md:pt-36 md:pb-28 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-20">
					<div className="max-w-xl">
						<p className="mb-5 flex items-center gap-2 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							<span className="h-px w-8 bg-[#9b5c3d]" />
							For property owners
						</p>
						<h1 className="font-display text-[clamp(3.7rem,8vw,7.5rem)] leading-[0.86] tracking-[-0.07em]">
							Make more of
							<br />
							<span className="text-[#9b5c3d]">your place.</span>
						</h1>
						<p className="mt-8 max-w-lg text-[#665d55] text-lg leading-relaxed sm:text-xl">
							We manage a small collection of stays that feel like home. If you
							have a property in Porto or Portugal&apos;s North Coast,
							let&apos;s see what it could become.
						</p>
						<div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 text-[#665d55] text-sm">
							<span className="inline-flex items-center gap-2">
								<MapPin className="size-4 text-[#9b5c3d]" />
								Porto &amp; the North Coast
							</span>
							<span className="text-[#c5b8aa]">/</span>
							<span className="inline-flex items-center gap-2">
								<Sparkles className="size-4 text-[#9b5c3d]" />A personal first
								conversation
							</span>
						</div>
					</div>

					<div className="relative mx-auto w-full max-w-xl lg:mr-0">
						<div className="relative aspect-[1.14] overflow-hidden rounded-[2rem] bg-[#d8c8b6] shadow-[0_24px_70px_-28px_rgba(63,44,31,0.5)]">
							<Image
								alt="A bright, thoughtfully furnished Alojamento Ideal apartment"
								className="object-cover"
								fill
								priority
								sizes="(max-width: 1024px) 100vw, 55vw"
								src="/about-living-room.jpg"
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
							<div className="absolute right-6 bottom-6 left-6 text-white sm:right-8 sm:bottom-8 sm:left-8">
								<p className="font-medium text-[10px] text-white/75 uppercase tracking-[0.2em]">
									The Alojamento Ideal approach
								</p>
								<p className="mt-1 font-display text-3xl tracking-[-0.03em]">
									Thoughtful stays, well looked after.
								</p>
							</div>
						</div>
						<div className="absolute -right-3 -bottom-8 hidden w-36 rotate-3 overflow-hidden rounded-2xl border-8 border-[#f8f5ef] shadow-xl sm:block sm:w-44">
							<div className="relative aspect-[0.8]">
								<Image
									alt="A calm bedroom in an Alojamento Ideal apartment"
									className="object-cover"
									fill
									sizes="176px"
									src="/about-bedroom.jpg"
								/>
							</div>
						</div>
					</div>
				</section>

				<section className="border-[#e6dbcf] border-y bg-[#f1ebe2]">
					<div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[0.45fr_1fr] md:items-center md:gap-20 md:py-20">
						<p className="font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							Why work with us
						</p>
						<div className="grid gap-5 sm:grid-cols-3 sm:gap-8">
							{BENEFITS.map((benefit) => (
								<div
									key={benefit}
									className="flex gap-3 text-[#665d55] text-sm leading-relaxed"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-[#9b5c3d]" />
									<span>{benefit}</span>
								</div>
							))}
						</div>
					</div>
				</section>

				<section
					id="enquire"
					className="mx-auto grid w-full max-w-6xl gap-14 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[0.7fr_1.3fr] lg:gap-24"
				>
					<div className="max-w-md">
						<p className="mb-4 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							Start here
						</p>
						<h2 className="font-display text-4xl leading-[0.94] tracking-[-0.05em] sm:text-5xl">
							Tell us about your property.
						</h2>
						<p className="mt-6 text-[#665d55] leading-relaxed">
							Share a few details and our team will get back to you. There is no
							obligation, just a useful first conversation about what would suit
							your property and your goals.
						</p>
						<Link
							className="group mt-7 inline-flex items-center gap-2 font-medium text-sm transition-colors hover:text-[#9b5c3d]"
							href="/about"
						>
							Learn about Alojamento Ideal
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					</div>
					<div>
						<OwnerContactForm />
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
