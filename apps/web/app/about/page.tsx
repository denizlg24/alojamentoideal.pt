import { Button } from "@workspace/ui/components/button";
import {
	ArrowRight,
	Compass,
	HeartHandshake,
	House,
	MapPin,
	Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPageMetadata({
	title: "About Us",
	description:
		"Meet Alojamento Ideal, a small collection of cozy, modern apartments and local experiences across Porto and Portugal's North Coast.",
	path: "/about",
	image: "/about-living-room.jpg",
	keywords: [
		"Alojamento Ideal",
		"about Alojamento Ideal",
		"apartments in Porto",
		"North Coast Portugal stays",
		"Póvoa de Varzim apartments",
		"Leça da Palmeira apartments",
		"Canidelo stays",
	],
});

const LOCATIONS = [
	{
		name: "Porto",
		caption: "History, river light and a city made for wandering.",
		image: "/about-porto.jpg",
	},
	{
		name: "Póvoa de Varzim",
		caption: "Atlantic air, long walks and an easy coastal rhythm.",
		image: "/about-povoa.jpg",
	},
	{
		name: "Leça da Palmeira",
		caption: "Rocky shores, sea views and space to slow down.",
		image: "/about-leca.jpg",
	},
	{
		name: "Canidelo",
		caption: "A quieter coast, close enough to the energy of Porto.",
		image: "/about-coast.jpg",
	},
] as const;

const PRINCIPLES = [
	{
		icon: House,
		title: "Feel at home",
		text: "Thoughtful spaces, proper kitchens and the small comforts that make settling in easy.",
	},
	{
		icon: Sparkles,
		title: "Made with care",
		text: "Every apartment is prepared and looked after by our team, from the first welcome to the final detail.",
	},
	{
		icon: Compass,
		title: "Stay local",
		text: "We choose places with a sense of place and help you discover the North Coast beyond the obvious stops.",
	},
	{
		icon: HeartHandshake,
		title: "Count on us",
		text: "Good hospitality is personal. We are here with clear communication and attentive support when you need it.",
	},
] as const;

export default function AboutPage() {
	return (
		<div className="min-h-screen bg-[#f8f5ef] text-[#2e2925]">
			<SiteHeader solid />

			<main>
				<section className="mx-auto grid w-full max-w-6xl gap-12 px-4 pt-28 pb-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20 lg:pt-36 lg:pb-28">
					<div className="max-w-xl">
						<p className="mb-5 flex items-center gap-2 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							<span className="h-px w-8 bg-[#9b5c3d]" />
							About Alojamento Ideal
						</p>
						<h1 className="font-display text-[clamp(3.5rem,8vw,7.5rem)] leading-[0.86] tracking-[-0.07em]">
							Stays that
							<br />
							<span className="text-[#9b5c3d] italic">feel like home.</span>
						</h1>
						<p className="mt-8 max-w-lg text-lg leading-relaxed text-[#665d55] sm:text-xl">
							We create comfortable, modern places to stay along Portugal&apos;s
							North Coast, with the warmth and ease of a home base.
						</p>
						<div className="mt-9 flex flex-wrap items-center gap-4">
							<Button
								asChild
								className="rounded-full bg-[#9b5c3d] px-6 text-white hover:bg-[#7f472f]"
							>
								<Link href="/homes">
									Explore our homes
									<ArrowRight className="size-4" />
								</Link>
							</Button>
							<Link
								href="/activities"
								className="group inline-flex items-center gap-2 font-medium text-sm transition-colors hover:text-[#9b5c3d]"
							>
								Find a local experience
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						</div>
					</div>

					<div className="relative mx-auto w-full max-w-xl lg:mr-0">
						<div className="relative aspect-[0.9] overflow-hidden rounded-[2rem] bg-[#d8c8b6] shadow-[0_24px_70px_-28px_rgba(63,44,31,0.5)] sm:aspect-[1.02]">
							<Image
								src="/about-living-room.jpg"
								alt="A bright, thoughtfully furnished Alojamento Ideal living room"
								fill
								priority
								className="object-cover"
								sizes="(max-width: 1024px) 100vw, 50vw"
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
							<div className="absolute right-5 bottom-5 left-5 flex items-end justify-between text-white sm:right-7 sm:bottom-7 sm:left-7">
								<div>
									<p className="font-medium text-[10px] uppercase tracking-[0.2em] text-white/75">
										Our way of hosting
									</p>
									<p className="mt-1 font-display text-2xl">
										Comfort, with character.
									</p>
								</div>
								<div className="grid size-11 place-items-center rounded-full border border-white/40 bg-white/15 backdrop-blur-sm">
									<ArrowRight className="size-5 -rotate-45" />
								</div>
							</div>
						</div>
						<div className="absolute -right-3 -bottom-8 hidden w-40 rotate-3 overflow-hidden rounded-2xl border-8 border-[#f8f5ef] shadow-xl sm:block sm:w-48">
							<div className="relative aspect-[0.8]">
								<Image
									src="/about-balcony.jpg"
									alt="A balcony with a view over Northern Portugal"
									fill
									className="object-cover"
									sizes="192px"
								/>
							</div>
						</div>
						<div className="absolute -bottom-7 -left-4 hidden items-center gap-2 rounded-full border border-[#eadfd2] bg-[#f8f5ef] px-4 py-2.5 text-xs shadow-lg sm:flex">
							<MapPin className="size-3.5 text-[#9b5c3d]" />
							<span>Portugal&apos;s North Coast</span>
						</div>
					</div>
				</section>

				<section className="bg-[#3f4d45] text-[#f7f2e9]">
					<div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[0.45fr_1fr] md:items-center md:gap-20 md:py-24">
						<p className="font-medium text-[#d5a77c] text-xs uppercase tracking-[0.22em]">
							The idea
						</p>
						<p className="max-w-3xl font-display text-3xl leading-tight tracking-[-0.03em] sm:text-4xl lg:text-5xl">
							A good stay should help you settle into a place, not just pass
							through it.
						</p>
					</div>
				</section>

				<section className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-20 md:py-32">
					<div className="relative overflow-hidden rounded-[1.75rem] bg-[#ddd1c2] md:order-2">
						<div className="relative aspect-[0.88] sm:aspect-[1.05]">
							<Image
								src="/about-bedroom.jpg"
								alt="A calm, welcoming bedroom prepared for guests"
								fill
								className="object-cover"
								sizes="(max-width: 768px) 100vw, 45vw"
							/>
						</div>
						<div className="absolute right-4 bottom-4 rounded-xl bg-[#f8f5ef]/90 px-4 py-3 backdrop-blur-sm sm:right-6 sm:bottom-6">
							<p className="font-medium text-[#9b5c3d] text-xs uppercase tracking-widest">
								Since day one
							</p>
							<p className="mt-1 font-display text-xl">The details matter.</p>
						</div>
					</div>
					<div className="max-w-xl md:order-1">
						<p className="mb-4 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							Who we are
						</p>
						<h2 className="font-display text-4xl leading-[0.98] tracking-[-0.05em] sm:text-5xl">
							A small team with a big love for this corner of Portugal.
						</h2>
						<div className="mt-7 space-y-5 text-[#665d55] leading-relaxed">
							<p>
								Alojamento Ideal owns and manages a small collection of
								apartments in Porto, Póvoa de Varzim, Leça da Palmeira and
								Canidelo. Each one is chosen and prepared to give you the
								freedom of a home with the care of a well-looked-after stay.
							</p>
							<p>
								We started with a simple belief: the best trips leave room for
								ordinary moments too. A slow breakfast, a quiet evening on the
								balcony, a local restaurant recommendation that turns into a
								favourite memory.
							</p>
						</div>
					</div>
				</section>

				<section className="border-y border-[#e6dbcf] bg-[#f1ebe2]">
					<div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
						<div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
							<div className="max-w-2xl">
								<p className="mb-4 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
									Where we are
								</p>
								<h2 className="font-display text-4xl leading-none tracking-[-0.05em] sm:text-5xl">
									Four places, one North Coast feeling.
								</h2>
							</div>
							<p className="max-w-sm text-[#665d55] leading-relaxed">
								From city streets to Atlantic shorelines, our homes make it easy
								to choose the pace that fits your trip.
							</p>
						</div>

						<div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{LOCATIONS.map((location, index) => (
								<article key={location.name} className="group">
									<div className="relative aspect-[0.82] overflow-hidden rounded-2xl bg-[#d8c8b6]">
										<Image
											src={location.image}
											alt={`${location.name}, Portugal`}
											fill
											className="object-cover transition duration-700 group-hover:scale-105"
											sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
										/>
										<div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
										<div className="absolute inset-x-4 bottom-4 text-white">
											<div className="mb-2 flex items-center justify-between">
												<span className="font-medium text-[10px] uppercase tracking-[0.2em] text-white/70">
													0{index + 1}
												</span>
												<MapPin className="size-3.5 text-white/80" />
											</div>
											<h3 className="font-display text-2xl">{location.name}</h3>
											<p className="mt-1 max-w-[18rem] text-sm leading-snug text-white/80">
												{location.caption}
											</p>
										</div>
									</div>
								</article>
							))}
						</div>
					</div>
				</section>

				<section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
					<div className="max-w-2xl">
						<p className="mb-4 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
							What we care about
						</p>
						<h2 className="font-display text-4xl leading-none tracking-[-0.05em] sm:text-5xl">
							The little things are the whole thing.
						</h2>
					</div>
					<div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#e6dbcf] bg-[#e6dbcf] sm:grid-cols-2 lg:grid-cols-4">
						{PRINCIPLES.map(({ icon: Icon, title, text }) => (
							<div key={title} className="bg-[#f8f5ef] p-6 sm:p-7">
								<div className="mb-12 grid size-10 place-items-center rounded-full bg-[#ead8c9] text-[#9b5c3d]">
									<Icon className="size-5" strokeWidth={1.7} />
								</div>
								<h3 className="font-display text-2xl">{title}</h3>
								<p className="mt-3 text-[#70665d] text-sm leading-relaxed">
									{text}
								</p>
							</div>
						))}
					</div>
				</section>

				<section className="relative isolate overflow-hidden bg-[#2f3b35] text-white">
					<div className="absolute inset-0 -z-10">
						<Image
							src="/about-coast.jpg"
							alt="The Atlantic coast at sunset"
							fill
							className="object-cover opacity-35"
							sizes="100vw"
						/>
						<div className="absolute inset-0 bg-[#26352f]/70 mix-blend-multiply" />
					</div>
					<div className="mx-auto flex min-h-[28rem] w-full max-w-6xl flex-col items-start justify-center px-4 py-20 sm:px-6 md:min-h-[34rem]">
						<p className="mb-5 font-medium text-[#e8ba8d] text-xs uppercase tracking-[0.22em]">
							Your next chapter starts here
						</p>
						<h2 className="max-w-3xl font-display text-5xl leading-[0.92] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
							Come for the coast.
							<br />
							Stay for the feeling.
						</h2>
						<div className="mt-9 flex flex-wrap items-center gap-5">
							<Button
								asChild
								className="rounded-full bg-[#f8f5ef] px-6 text-[#2f3b35] hover:bg-white"
							>
								<Link href="/homes">
									Find your home base
									<ArrowRight className="size-4" />
								</Link>
							</Button>
							<Link
								href="/activities"
								className="group inline-flex items-center gap-2 font-medium text-sm text-white/85 hover:text-white"
							>
								Explore local activities
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						</div>
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
