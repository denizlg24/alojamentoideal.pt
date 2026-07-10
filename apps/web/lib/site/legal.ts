export const LEGAL_UPDATED_ON = "10 July 2026";

export const LEGAL_PAGE_ORDER = [
	"company-information",
	"terms",
	"cancellation-and-refunds",
	"privacy",
	"data-protection",
	"cookies",
	"complaints",
] as const;

export type LegalSlug = (typeof LEGAL_PAGE_ORDER)[number];

export interface LegalSection {
	bullets?: readonly string[];
	paragraphs: readonly string[];
	title: string;
}

export interface LegalPageDefinition {
	description: string;
	intro: string;
	sections: readonly LegalSection[];
	title: string;
}

export const LEGAL_PAGES: Record<LegalSlug, LegalPageDefinition> = {
	"company-information": {
		title: "Company information",
		description:
			"The legal and contact details for Alojamento Ideal and its operator in Portugal.",
		intro:
			"Alojamento Ideal is the trading name used by the company that owns and manages the homes and activities offered on this website.",
		sections: [
			{
				title: "Operator",
				paragraphs: [
					"Relevos Inalcançáveis, Lda.",
					"NIF / NIPC: 517 439 972",
					"Rua António Ramalho 171, 4460-241 Senhora da Hora, Portugal",
				],
			},
			{
				title: "Contact",
				paragraphs: [
					"For bookings, questions, complaints or privacy requests, contact support@alojamentoideal.pt. You can also write to the postal address above.",
					"The website is alojamentoideal.pt. Alojamento Ideal is not a marketplace. The homes presented here are operated by us, and activities may be delivered by the activity provider identified before purchase.",
				],
			},
			{
				title: "Regulatory information",
				paragraphs: [
					"The applicable accommodation registration details, where required, are shown in the listing or booking information for the relevant home. Please contact us before booking if you need a registration number or accessibility information for a particular property.",
				],
			},
		],
	},
	terms: {
		title: "Terms & Conditions",
		description:
			"The terms that apply when you use Alojamento Ideal or book one of our homes or activities.",
		intro:
			"These terms apply to the alojamentoideal.pt website and to bookings made through it. They are written for direct bookings with Relevos Inalcançáveis, Lda.",
		sections: [
			{
				title: "Using the website",
				paragraphs: [
					"Use the website lawfully and provide information that is accurate, complete and current. You are responsible for the account details and contact information you submit.",
					"Listings, photographs and descriptions are intended to describe the relevant home or activity accurately. Small differences in layout, furnishings or availability can occur, and the booking information shown at checkout is the information that applies to your reservation.",
				],
			},
			{
				title: "A booking is made in two steps",
				paragraphs: [
					"A checkout request may place a short-lived hold while live availability and payment are checked. A booking is only confirmed when we issue a confirmation. If the provider cannot confirm a reservation after payment, we will tell you and refund the affected amount.",
					"The final price, dates, guests, inclusions, taxes and any item-specific rules are shown before you pay. Your booking email and the booking page are durable records of the contract details.",
				],
			},
			{
				title: "Guest responsibilities",
				paragraphs: [
					"Follow the house rules, check-in and check-out instructions, safety guidance and any activity instructions supplied with your booking. Only the guests declared for the booking may use a home unless we agree otherwise.",
					"You are responsible for damage caused by you or a member of your party, except where the damage was not your responsibility under applicable law. Do not use a home for unlawful, dangerous or disruptive activity.",
				],
			},
			{
				title: "Payments and invoices",
				paragraphs: [
					"Payments are processed by Stripe. We do not receive or store your full card number. We issue fiscal documents using the billing details supplied at checkout and the applicable Portuguese tax rules.",
				],
			},
			{
				title: "Changes outside your control",
				paragraphs: [
					"If circumstances outside our reasonable control affect a booking, we will contact you promptly and explain the available options. Nothing in these terms limits mandatory consumer rights or our liability where it cannot legally be limited.",
				],
			},
			{
				title: "Applicable law",
				paragraphs: [
					"Portuguese law applies, without removing any mandatory protection available to a consumer in the country where they live. The competent courts are determined by the applicable consumer and procedural rules.",
				],
			},
		],
	},
	"cancellation-and-refunds": {
		title: "Cancellation & refunds",
		description:
			"How cancellation, refunds and date changes work for Alojamento Ideal bookings.",
		intro:
			"Cancellation terms can differ between homes, rates and activities. The policy shown on the listing and again at checkout is part of the booking and takes priority over this general explanation.",
		sections: [
			{
				title: "Before you book",
				paragraphs: [
					"Check the cancellation line in the price breakdown and review step before paying. A rate may be flexible, partly refundable or non-refundable. The relevant dates and refund amount are calculated from the booking and service dates shown there.",
				],
			},
			{
				title: "Requesting a cancellation",
				paragraphs: [
					"Use the booking page when cancellation is available, or contact support@alojamentoideal.pt from the email used for the booking. A cancellation is not complete until we confirm it in writing.",
					"When a refund is due, we send it to the original payment method. Banks and card providers control the final time it takes to appear. Any non-refundable amount, provider charge or amount expressly excluded by the displayed policy remains payable where legally permitted.",
				],
			},
			{
				title: "Date changes and changes by us",
				paragraphs: [
					"A date change is a new availability and price request. It only takes effect after we confirm it. If we must cancel or materially change a confirmed booking, we will explain the available remedy, which may include an alternative, a credit where agreed or a refund.",
				],
			},
			{
				title: "No 14-day cooling-off period for dated bookings",
				paragraphs: [
					"Portuguese law excludes accommodation supplied for a specific date or period, and leisure services supplied for a specific date or period, from the general 14-day right of withdrawal. This does not remove the cancellation rights shown for your rate or any other mandatory consumer right.",
				],
			},
		],
	},
	privacy: {
		title: "Privacy Policy",
		description:
			"How Alojamento Ideal collects and uses personal data when you browse or book.",
		intro:
			"This policy explains how Relevos Inalcançáveis, Lda. processes personal data for alojamentoideal.pt, accounts, bookings, guest support and related services.",
		sections: [
			{
				title: "What we collect",
				paragraphs: [
					"Depending on what you do, we may collect your name, email address, telephone number, account credentials, billing details, tax number, booking dates, guest information, messages and information needed to provide a home or activity.",
					"Where identity or guest registration is required, we may process date of birth, nationality, country of residence and identity-document information. Do not send identity documents by email unless we specifically direct you to a secure verification flow.",
					"We also receive technical information such as IP address, browser, device, pages viewed, security events and error data. Payment card details are handled by Stripe, not stored by us in full.",
				],
			},
			{
				title: "Why we use it",
				bullets: [
					"to provide the website, account and booking service;",
					"to check availability, take payment, issue invoices and manage cancellations or refunds;",
					"to meet accommodation, guest-registration, tax, fraud-prevention and other legal duties;",
					"to answer questions, send booking and service messages, and protect the security of our systems;",
					"to understand reliability and product performance using limited technical and operational data.",
				],
				paragraphs: [
					"We do not sell personal data. We only send marketing where we have a lawful basis and the required consent or opt-out mechanism.",
				],
			},
			{
				title: "Who receives it",
				paragraphs: [
					"We share the minimum information needed with processors and providers that help us operate the service, including Stripe for payment, hosting and security providers, email delivery, property operations, activity providers and invoicing services. They must process data under our instructions or their own applicable legal responsibilities.",
					"Some providers may process data outside the European Economic Area. Where that happens, we use a lawful transfer mechanism and appropriate safeguards required by data-protection law.",
				],
			},
			{
				title: "Retention and security",
				paragraphs: [
					"We keep data only for as long as needed for the purpose collected, the booking relationship, legal and tax records, dispute handling and security. Identity data is subject to additional access controls and deletion or anonymisation when the applicable retention period ends.",
					"We use access controls, encryption where appropriate, secure payment processing and monitoring. No internet transmission is completely risk-free, but we investigate and respond to security incidents as required.",
				],
			},
			{
				title: "Your rights",
				paragraphs: [
					"Subject to legal limits, you can ask for access, correction, deletion, restriction, portability or objection, and you can withdraw consent where processing relies on consent. You can also complain to the Comissão Nacional de Proteção de Dados (CNPD).",
					"Send a request to support@alojamentoideal.pt. We may need to verify your identity before responding. More detail about exercising these rights is on our Data Protection page.",
				],
			},
		],
	},
	"data-protection": {
		title: "Data protection requests",
		description:
			"How to exercise your GDPR rights with Alojamento Ideal and contact the Portuguese data-protection authority.",
		intro:
			"This page is a practical guide to requests about personal data. It complements the Privacy Policy and does not replace it.",
		sections: [
			{
				title: "Make a request",
				paragraphs: [
					"Email support@alojamentoideal.pt with the subject “Data protection request”. Tell us what you need, the email address or booking reference connected to the request, and how you would like us to respond.",
					"We may ask for proportionate information to confirm that the request is yours. Please do not send a passport, identity card or other sensitive document by ordinary email unless our team gives you a secure method to do so.",
				],
			},
			{
				title: "Available rights",
				bullets: [
					"access to personal data and information about its use;",
					"correction of inaccurate or incomplete data;",
					"deletion where there is no legal reason to keep it;",
					"restriction of processing in the cases provided by law;",
					"data portability for data processed by automated means on consent or contract;",
					"objection to processing based on legitimate interests or direct marketing;",
					"withdrawal of consent, without affecting processing already carried out lawfully.",
				],
				paragraphs: [
					"These rights are not absolute. We may retain or use information needed for legal, tax, security or dispute purposes.",
				],
			},
			{
				title: "Response time and complaints",
				paragraphs: [
					"We normally respond within one month. If a request is complex, the period may be extended as permitted by law and we will explain why.",
					"If you are not satisfied, you can contact the CNPD at www.cnpd.pt or use its complaint channels. You may also contact us first so we can try to resolve the issue directly.",
				],
			},
		],
	},
	cookies: {
		title: "Cookie Policy",
		description:
			"The cookies and similar technologies used by alojamentoideal.pt.",
		intro:
			"We keep cookies to the minimum needed for the site and booking flow to work. This policy describes the current setup and will be updated if optional technologies are added.",
		sections: [
			{
				title: "Strictly necessary cookies",
				paragraphs: [
					"We use first-party, security-protected cookies for the anonymous cart, signed-in session and limited booking access. They remember the state needed to display your cart, protect account and booking pages, and complete a booking.",
					"These cookies cannot be switched off in our systems because the requested service would not work without them. They do not store full payment-card details.",
				],
			},
			{
				title: "Payment and embedded services",
				paragraphs: [
					"Stripe may set cookies or use similar technologies when its payment form, fraud-prevention tools or authentication flows are loaded. Those technologies are controlled by Stripe under its own privacy and cookie information.",
				],
			},
			{
				title: "What we do not use",
				paragraphs: [
					"At the time of this update, we do not use advertising cookies or optional analytics cookies on the public website. If that changes, we will ask for consent where required before setting non-essential cookies and update this page.",
				],
			},
			{
				title: "Your choices",
				paragraphs: [
					"You can delete or block cookies in your browser. Blocking necessary cookies may prevent sign-in, cart and checkout features from working. For more information about personal data processed through cookies, see our Privacy Policy.",
				],
			},
		],
	},
	complaints: {
		title: "Complaints & consumer disputes",
		description:
			"How to contact Alojamento Ideal, use the Portuguese complaints book and access consumer ADR.",
		intro:
			"Please contact us first. Most booking problems can be resolved faster when we have the booking reference, the relevant dates and a clear description of what happened.",
		sections: [
			{
				title: "Contact us",
				paragraphs: [
					"Email support@alojamentoideal.pt or write to Relevos Inalcançáveis, Lda., Rua António Ramalho 171, 4460-241 Senhora da Hora, Portugal. Keep the confirmation email and any messages exchanged with us.",
				],
			},
			{
				title: "Livro de Reclamações",
				paragraphs: [
					"Consumers may use the Portuguese electronic complaints book at www.livroreclamacoes.pt. The link is also available in the website footer.",
				],
			},
			{
				title: "Alternative dispute resolution",
				paragraphs: [
					"For consumer disputes in the Porto metropolitan area, the competent centre is the Centro de Informação de Consumo e Arbitragem do Porto (CICAP), Rua Damião de Góis, 31, Loja 6, 4050-225 Porto, tel. 225 508 349, email cicap@cicap.pt, www.cicap.pt. Its territorial and subject-matter competence should be confirmed with the centre.",
					"You may also find the competent Portuguese consumer ADR entity through the Directorate-General for Consumers at www.consumidor.gov.pt. The former European Online Dispute Resolution platform is no longer available.",
				],
			},
		],
	},
};

export const LEGAL_NAVIGATION = LEGAL_PAGE_ORDER.map((slug) => ({
	href: `/legal/${slug}`,
	label: LEGAL_PAGES[slug].title,
}));
