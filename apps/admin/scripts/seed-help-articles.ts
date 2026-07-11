import { randomUUID } from "node:crypto";
import { getDb, helpArticle } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Deploy-time seed: guarantees the initial help-center guides exist. Runs
 * after migrations in the admin app's Vercel build (see apps/admin/vercel.json)
 * and is idempotent: articles are matched by slug and never overwritten, so
 * edits made in the admin UI always win over this seed.
 */
interface SeedArticle {
	contentMd: string;
	excerpt: string;
	slug: string;
	sortOrder: number;
	title: string;
}

const SEED_ARTICLES: SeedArticle[] = [
	{
		slug: "how-to-make-a-reservation",
		title: "How to make a reservation",
		excerpt:
			"From browsing our homes to receiving your confirmation email, step by step.",
		sortOrder: 10,
		contentMd: `Booking one of our apartments takes just a few minutes. Here is the full journey.

## 1. Find your home

Open the [Homes](/homes) page and browse our apartments in Porto, Póvoa de Varzim, Leça da Palmeira and Canidelo. You can filter by location, dates and number of guests to see only the places available for your trip.

## 2. Pick your dates and guests

On the apartment page, choose your check-in and check-out dates and the number of guests. The price breakdown updates as you go, showing the nightly rate, any fees and applicable taxes. The total you see is the total you pay.

## 3. Add to cart and check out

Add the stay to your cart. If you also want to book activities, you can add them to the same cart and pay for everything together. When you are ready, go to checkout, fill in your contact details and pay securely by card.

## 4. Receive your confirmation

We reserve the apartment as soon as your payment goes through, and you receive a confirmation email once the booking is finalised. That email contains everything you need, including arrival instructions.

If anything goes wrong and a booking cannot be confirmed, we refund your payment in full automatically.

## Need to change something?

Send us a message through the [help page](/help) with your confirmation details and we will do our best to adjust your booking, subject to availability.`,
	},
	{
		slug: "check-in-and-check-out-times",
		title: "Check-in and check-out times",
		excerpt:
			"When you can arrive, when to leave, and how to request an early or late time.",
		sortOrder: 20,
		contentMd: `## Where to find your times

Check-in and check-out times can vary by apartment, so the exact times for your stay are listed in your booking confirmation email. Keep it handy for your arrival day.

## How check-in works

All of our apartments use self check-in. Shortly before your stay you receive detailed arrival instructions, including how to access the apartment. There is no front desk and no waiting around: you arrive when it suits you, within the check-in window.

## Early arrival or late departure

Arriving on an early flight or leaving late in the day? Send us a message through the [help page](/help) with your booking reference and the time you have in mind. We cannot always say yes, because the apartment may need to be prepared for the next guests, but we will always try.

## Luggage

If your plans leave a gap between arrival and check-in, write to us. We are happy to suggest trusted luggage storage options near your apartment.`,
	},
	{
		slug: "how-to-book-an-activity",
		title: "How to book an activity",
		excerpt:
			"Tours and local experiences, bookable on their own or together with your stay.",
		sortOrder: 30,
		contentMd: `Alongside our apartments we offer a curated selection of local tours and experiences across Porto and the North Coast.

## 1. Browse activities

Open the [Activities](/activities) page to see what is on offer. Each activity page describes the experience, the meeting or pickup arrangements, and what is included.

## 2. Check the details before you pay

Every activity is run by a trusted local partner and follows its own cancellation policy. The exact terms are shown on the activity page before you pay, so you always know the rules for your booking.

## 3. Choose a date and book

Pick your date and the number of participants, then add the activity to your cart. You can pay for it on its own or together with an apartment stay in a single checkout.

## 4. After booking

You receive a confirmation email with your tickets and any instructions from the activity provider. Some activities ask a few extra questions, such as pickup location or dietary needs; you can provide and update those from your order page.`,
	},
	{
		slug: "how-to-complete-checkout",
		title: "How to complete checkout",
		excerpt:
			"What happens between clicking pay and receiving your confirmation.",
		sortOrder: 40,
		contentMd: `## Review your cart

Your cart shows every stay and activity you are about to book, each with its own price breakdown. Take a moment to confirm dates, guests and participants; you can still edit everything at this point.

## Pay securely

Enter your contact details and pay by card. Payments are processed by Stripe over an encrypted connection, and your full card details never touch our servers.

## The short confirmation window

After payment we confirm each item of your order with the calendar and, for activities, with the local provider. This usually takes moments. You receive your confirmation email as soon as everything is locked in.

## If something cannot be confirmed

On rare occasions an item cannot be confirmed, for example if an availability conflict appears at the last moment. When that happens we refund that payment in full automatically, back to the card you paid with. You do not need to request anything.`,
	},
	{
		slug: "how-to-provide-guest-data",
		title: "How to provide guest data",
		excerpt:
			"Why we ask for guest details before arrival and how to submit them.",
		sortOrder: 50,
		contentMd: `## Why we ask

Portuguese law requires accommodation providers to register every guest who stays with them with the national authorities. This applies to all short-term rentals in Portugal, not just ours. To do this we need a few details for each guest before arrival.

## What we need

For every guest staying in the apartment:

- Full name
- Nationality and country of residence
- Date of birth
- Identification document (passport or national ID card)

## How to submit

After booking you receive a secure link by email. Open it, add each guest, and submit. It takes a few minutes and you can complete it from your phone. The lead guest can fill in everyone's details, or invite the other guests to fill in their own.

## Your privacy

Guest details are used only for the legal registration and are handled according to our [privacy policy](/legal/privacy). If any detail changes before your stay, just reopen the link and update it, or send us a message through the [help page](/help).`,
	},
];

async function seedHelpArticles(): Promise<void> {
	const db = getDb();

	for (const article of SEED_ARTICLES) {
		const [existing] = await db
			.select({ id: helpArticle.id })
			.from(helpArticle)
			.where(eq(helpArticle.slug, article.slug))
			.limit(1);

		if (existing) {
			console.log(
				`seed-help-articles: "${article.slug}" already exists; leaving it untouched.`,
			);
			continue;
		}

		await db.insert(helpArticle).values({
			id: randomUUID(),
			published: true,
			...article,
		});
		console.log(`seed-help-articles: created "${article.slug}".`);
	}
}

try {
	await seedHelpArticles();
	// The pg pool keeps the event loop alive; exit explicitly once done.
	process.exit(0);
} catch (error) {
	console.error("seed-help-articles: failed", error);
	process.exit(1);
}
