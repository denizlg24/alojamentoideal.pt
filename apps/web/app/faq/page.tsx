import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPageMetadata({
	title: "FAQ",
	description:
		"Answers about booking, payments, cancellation, check-in and support for Alojamento Ideal stays and activities across Porto and Portugal's North Coast.",
	path: "/faq",
	keywords: [
		"Alojamento Ideal FAQ",
		"booking questions Porto",
		"cancellation policy apartments Portugal",
		"check-in Porto apartment",
		"North Coast Portugal stays",
	],
});

interface FaqEntry {
	question: string;
	answer: ReactNode;
}

interface FaqCategory {
	title: string;
	intro: string;
	entries: FaqEntry[];
}

const FAQ_CATEGORIES: FaqCategory[] = [
	{
		title: "Booking & Reservations",
		intro: "How a stay or activity goes from browsing to booked.",
		entries: [
			{
				question: "How do I book one of your apartments?",
				answer:
					"Browse our homes, choose your dates and number of guests, and you will see a full price breakdown before anything is charged. Add the stay to your cart and complete checkout with a secure card payment. We send a confirmation email as soon as your booking is confirmed.",
			},
			{
				question: "Is my booking confirmed as soon as I pay?",
				answer:
					"Almost always, yes. When you pay we place the reservation right away, and you receive your confirmation email once it is finalised. In the rare case a stay or activity cannot be confirmed, we refund the payment in full automatically.",
			},
			{
				question: "Can I book a stay and activities in the same order?",
				answer:
					"Yes. Stays and activities share one cart, so you can pay for your apartment and your tours together in a single checkout.",
			},
			{
				question: "Can I change my booking after it is confirmed?",
				answer: (
					<>
						Send us a message through the{" "}
						<Link className="underline underline-offset-4" href="/help">
							help page
						</Link>{" "}
						with your confirmation details. We will do our best to adjust dates
						or guests, subject to availability.
					</>
				),
			},
		],
	},
	{
		title: "Cancellation & Refunds",
		intro: "What happens if plans change.",
		entries: [
			{
				question: "What is the cancellation policy for stays?",
				answer: (
					<>
						You receive a full refund if you cancel within 48 hours of booking,
						as long as check-in is still at least 14 days away. After that
						window, cancellations made 7 or more days before check-in are
						refunded at 50%. Cancellations under 7 days before check-in are not
						refundable. The full policy is in our{" "}
						<Link
							className="underline underline-offset-4"
							href="/legal/cancellation-and-refunds"
						>
							cancellation and refunds terms
						</Link>
						.
					</>
				),
			},
			{
				question: "What about activities and tours?",
				answer:
					"Each activity follows its own cancellation policy, set by the local partner who runs it. The exact terms are shown on the activity page before you pay, so you always know where you stand.",
			},
			{
				question: "How long does a refund take to arrive?",
				answer:
					"Refunds always go back to the payment method you used at checkout. We issue them promptly, and banks typically take 5 to 10 business days to make the money visible on your statement.",
			},
			{
				question: "What if you cannot confirm my booking?",
				answer:
					"If we cannot confirm a stay or an activity after you have paid, we refund that payment in full automatically. You do not need to request it.",
			},
		],
	},
	{
		title: "Check-in & Stay",
		intro: "Arriving, settling in and what to expect.",
		entries: [
			{
				question: "How does check-in work?",
				answer:
					"Our apartments use self check-in. You receive detailed arrival and access instructions with your booking confirmation, so you can get in easily whenever you arrive.",
			},
			{
				question: "What are the check-in and check-out times?",
				answer: (
					<>
						Times can vary by apartment, so the exact check-in and check-out
						times for your stay are included in your booking confirmation. If
						you would like an earlier arrival or a later departure, reach out
						through the{" "}
						<Link className="underline underline-offset-4" href="/help">
							help page
						</Link>{" "}
						and we will try to accommodate it.
					</>
				),
			},
			{
				question: "Why do you ask for guest details before arrival?",
				answer:
					"Portuguese law requires accommodation providers to register every guest with the authorities. After booking you receive a secure link to provide each guest's details and identification document. It only takes a few minutes and keeps check-in smooth.",
			},
			{
				question: "What is included in the apartment?",
				answer:
					"Every apartment is fully equipped: fresh linens and towels, a proper kitchen, and the essentials you need to feel at home. Each one is prepared by our own team before you arrive.",
			},
		],
	},
	{
		title: "Payments & Security",
		intro: "How paying works and how your data is protected.",
		entries: [
			{
				question: "How do I pay?",
				answer:
					"You pay by card at checkout through Stripe, our payment provider. The booking is paid in full when you reserve, so there is nothing to settle on arrival.",
			},
			{
				question: "Are there hidden fees?",
				answer:
					"No. The breakdown you see before paying lists the nightly rate, any fees and applicable taxes. The total shown at checkout is exactly what you pay.",
			},
			{
				question: "Is my card information safe?",
				answer:
					"Yes. Payments are processed by Stripe over an encrypted connection, and your full card details never touch our servers.",
			},
			{
				question: "Where do refunds go?",
				answer:
					"Refunds are always returned to the original payment method used at checkout.",
			},
		],
	},
	{
		title: "Support",
		intro: "Who we are and how to reach us.",
		entries: [
			{
				question: "How do I contact you?",
				answer: (
					<>
						The quickest way is the contact form on our{" "}
						<Link className="underline underline-offset-4" href="/help">
							help page
						</Link>
						. You can also email us at{" "}
						<a
							className="underline underline-offset-4"
							href="mailto:geral@alojamentoideal.pt"
						>
							geral@alojamentoideal.pt
						</a>
						. We reply as quickly as we can, and always to the address you write
						from.
					</>
				),
			},
			{
				question: "Am I booking through a marketplace?",
				answer:
					"No. Alojamento Ideal owns and manages every apartment on this site. When you book with us you deal directly with the team that prepares and looks after your stay.",
			},
			{
				question: "Where are your apartments?",
				answer:
					"Along Portugal's North Coast: Porto, Póvoa de Varzim, Leça da Palmeira and Canidelo. Each location has its own rhythm, from city streets to Atlantic shoreline.",
			},
		],
	},
];

export default function FaqPage() {
	return (
		<div className="min-h-screen bg-[#f8f5ef] text-[#2e2925]">
			<SiteHeader solid />

			<main>
				<section className="mx-auto w-full max-w-6xl px-4 pt-28 pb-16 sm:px-6 lg:pt-36 lg:pb-24">
					<p className="mb-5 flex items-center gap-2 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
						<span className="h-px w-8 bg-[#9b5c3d]" />
						Frequently asked questions
					</p>
					<h1 className="max-w-3xl font-display text-[clamp(3rem,7vw,6.5rem)] leading-[0.88] tracking-[-0.06em]">
						Good stays start with
						<span className="text-[#9b5c3d] italic"> clear answers.</span>
					</h1>
					<p className="mt-7 max-w-xl text-[#665d55] text-lg leading-relaxed">
						Everything guests usually ask us about booking, paying, cancelling
						and arriving. If your question is not here, our help page is one
						click away.
					</p>
				</section>

				<section className="border-[#e6dbcf] border-t">
					{FAQ_CATEGORIES.map((category, index) => (
						<div
							key={category.title}
							className="border-[#e6dbcf] border-b last:border-b-0"
						>
							<div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20 lg:py-20">
								<div className="lg:sticky lg:top-28 lg:self-start">
									<p className="font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
										0{index + 1}
									</p>
									<h2 className="mt-3 font-display text-3xl leading-none tracking-[-0.04em] sm:text-4xl">
										{category.title}
									</h2>
									<p className="mt-4 max-w-xs text-[#665d55] text-sm leading-relaxed">
										{category.intro}
									</p>
								</div>
								<Accordion collapsible type="single">
									{category.entries.map((entry) => (
										<AccordionItem
											className="border-[#e6dbcf]"
											key={entry.question}
											value={entry.question}
										>
											<AccordionTrigger className="py-6 text-left font-display text-lg tracking-[-0.01em] hover:no-underline sm:text-xl [&>svg]:text-[#9b5c3d]">
												{entry.question}
											</AccordionTrigger>
											<AccordionContent className="max-w-2xl pb-7 text-[#665d55] text-base leading-relaxed">
												{entry.answer}
											</AccordionContent>
										</AccordionItem>
									))}
								</Accordion>
							</div>
						</div>
					))}
				</section>

				<section className="bg-[#3f4d45] text-[#f7f2e9]">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-7 px-4 py-16 sm:px-6 md:flex-row md:items-end md:justify-between md:py-20">
						<div>
							<p className="mb-4 font-medium text-[#d5a77c] text-xs uppercase tracking-[0.22em]">
								Still wondering about something?
							</p>
							<h2 className="max-w-xl font-display text-4xl leading-none tracking-[-0.04em] sm:text-5xl">
								Our help page has guides and a direct line to us.
							</h2>
						</div>
						<Link
							className="group inline-flex items-center gap-3 rounded-full bg-[#f8f5ef] px-6 py-3.5 font-medium text-[#2f3b35] text-sm transition hover:bg-white"
							href="/help"
						>
							Visit the help page
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
