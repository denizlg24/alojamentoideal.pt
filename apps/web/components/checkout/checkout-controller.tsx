"use client";

import type { AccountProfile } from "@workspace/core/account";
import type {
	CartDto,
	CartItemDto,
	CartValidationResponse,
	PaymentIntentResponse,
} from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth/client";
import { nightsBetween } from "@/lib/catalog/dates";
import { capacityForGuests } from "@/lib/catalog/guests";
import { trackCheckoutEvent } from "@/lib/checkout/analytics";
import * as api from "@/lib/checkout/api-client";
import { CHECKOUT_CART_STORAGE_KEY } from "@/lib/checkout/api-client";
import { toCheckoutError } from "@/lib/checkout/errors";
import {
	formatMinor,
	formatStayRangeLong,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";
import {
	cartItemClientMutationId,
	cartItemIdempotencyKey,
	randomIdempotencyKey,
	type StayKeyInput,
} from "@/lib/checkout/idempotency";
import {
	clearResumeState,
	isResumeUsable,
	readResumeState,
	stayKeyToken,
	writeResumeState,
} from "@/lib/checkout/resume";
import { ChangeDatesDialog } from "./change-dates-dialog";
import {
	ChangeGuestsDialog,
	type GuestSelection,
} from "./change-guests-dialog";
import { CheckoutAlert } from "./checkout-alert";
import { CheckoutAuthPrompt } from "./checkout-auth-prompt";
import { CheckoutLayout } from "./checkout-layout";
import { ConfirmPayButton } from "./confirm-pay-button";
import { ContactBillingForm } from "./contact-billing-form";
import { CurrencyDialog } from "./currency-dialog";
import { DiscountCodeForm } from "./discount-code-form";
import { PayTimingStep } from "./pay-timing-step";
import { CheckoutPaymentElement } from "./payment-element";
import { PaymentMethodStep } from "./payment-method-step";
import { PriceBreakdownDialog } from "./price-breakdown-dialog";
import {
	ReservationSummary,
	type ReservationSummaryItem,
} from "./reservation-summary";
import { ReviewReservationStep } from "./review-reservation-step";
import { StripePaymentForm } from "./stripe-payment-form";
import {
	applyProfileToContactDraft,
	type ContactDraft,
	contactDraftFromOrderContact,
	emptyContactDraft,
	hasBillingDetails,
	type InitialListing,
	type InitialStay,
	profileInputFromContactDraft,
} from "./types";
import { usePendingMessages } from "./use-pending-messages";

const CART_STORAGE_KEY = CHECKOUT_CART_STORAGE_KEY;

/**
 * Reserved height for the payment area, shared by the loading skeleton and the
 * mounted Stripe Payment Element. Reserving the space keeps the review step and
 * Confirm button from jumping as the Element's iframe grows to its final height.
 * Tuned to the tabs layout (method tabs + card + expiry/CVC + country/postal).
 */
const PAYMENT_AREA_MIN_HEIGHT = "min-h-[20rem]";

/**
 * Order/payment failures that mean the in-progress draft order can no longer be
 * paid. When the resume or final-refresh path hits one of these, the stored
 * resume metadata is dropped so checkout cleanly restarts from a fresh cart.
 */
const ORDER_RESTART_CODES = new Set([
	"cart_expired",
	"cart_not_found",
	"order_expired",
	"order_not_found",
	"order_not_payable",
]);

const CHECKOUT_BOOTSTRAP_MESSAGES = [
	"Checking your stay details.",
	"Refreshing live price and availability.",
	"Loading your booking summary.",
] as const;

const PAYMENT_PREPARATION_MESSAGES = [
	"Creating your booking order.",
	"Preparing your secure payment form.",
	"Connecting to the payment provider.",
] as const;

const PAYMENT_ELEMENT_MESSAGES = [
	"Loading the secure payment form.",
	"Connecting to Stripe.",
] as const;

type DialogKind = "currency" | "dates" | "guests" | "price" | null;

/** Local reference to the frozen draft order; never the client secret. */
interface DraftOrderRef {
	checkoutExpiresAt: string | null;
	orderId: string;
	publicReference: string;
}

interface CheckoutControllerProps {
	initialListing: InitialListing;
	initialStay: InitialStay;
}

function activeItemOf(cart: CartDto | null): CartItemDto | null {
	return cart?.items.find((entry) => entry.status === "active") ?? null;
}

function stayKeyFromItem(listingId: string, item: CartItemDto): StayKeyInput {
	return {
		adults: item.adults,
		checkIn: item.checkIn,
		checkOut: item.checkOut,
		children: item.children,
		guests: item.guests,
		infants: item.infants,
		listingId,
	};
}

function pendingSummaryItemOf(
	stay: InitialStay,
): ReservationSummaryItem | null {
	if (!stay.checkIn || !stay.checkOut) {
		return null;
	}

	const nights = nightsBetween(stay.checkIn, stay.checkOut);
	if (!Number.isFinite(nights) || nights < 1) {
		return null;
	}

	return {
		adults: stay.adults,
		checkIn: stay.checkIn,
		checkOut: stay.checkOut,
		children: stay.children,
		infants: stay.infants,
		nights,
	};
}

/**
 * Stand-in for the Stripe Payment Element while the draft order + PaymentIntent
 * are created in the background. Mirrors the Element's rough shape (method tabs,
 * card number, expiry/CVC) so the optimistic swap from the contact form does not
 * shift the layout when the real Element mounts.
 */
function PaymentElementSkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-3">
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-12 w-full rounded-lg" />
			<div className="grid grid-cols-2 gap-3">
				<Skeleton className="h-12 w-full rounded-lg" />
				<Skeleton className="h-12 w-full rounded-lg" />
			</div>
			<Skeleton className="h-12 w-full rounded-lg" />
		</div>
	);
}

interface PaymentLoadingStatusProps {
	detail?: string;
	message: string;
}

function PaymentLoadingStatus({ detail, message }: PaymentLoadingStatusProps) {
	return (
		<div
			aria-live="polite"
			className="rounded-xl border bg-muted/60 px-4 py-3"
			role="status"
		>
			<div className="flex items-start gap-3">
				<span
					aria-hidden
					className="mt-1.5 size-2.5 shrink-0 rounded-full bg-foreground/70"
				/>
				<div className="flex flex-col gap-1">
					<p className="font-medium text-sm">{message}</p>
					<p className="text-muted-foreground text-sm">
						{detail ??
							'You will not be charged until you review the details and press "Confirm and pay".'}
					</p>
				</div>
			</div>
		</div>
	);
}

function CheckoutBootstrapLoading() {
	const message = usePendingMessages(true, CHECKOUT_BOOTSTRAP_MESSAGES, 3500);

	return (
		<div className="flex flex-col gap-4">
			<PaymentLoadingStatus
				detail="This usually takes a few seconds while we refresh availability."
				message={message}
			/>
			<Skeleton className="h-40 w-full rounded-2xl" />
			<Skeleton className="h-64 w-full rounded-2xl" />
		</div>
	);
}

export function CheckoutController({
	initialListing,
	initialStay,
}: CheckoutControllerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { data: session } = useSession();
	// Drives the contact prefill / cart-claim effect below so an in-overlay login
	// (the auth dialog opened from checkout) updates the booking without a reload.
	const sessionUserId = session?.user?.id ?? null;

	const [phase, setPhase] = useState<"error" | "loading" | "ready">("loading");
	const [fatalError, setFatalError] = useState<string | null>(null);
	const [cart, setCart] = useState<CartDto | null>(null);
	const [contact, setContact] = useState<ContactDraft>(emptyContactDraft);
	const [contactPrefilled, setContactPrefilled] = useState(false);
	const [signedIn, setSignedIn] = useState(false);
	const [saveToAccount, setSaveToAccount] = useState(false);
	const [editingContact, setEditingContact] = useState(false);
	const [savingContact, setSavingContact] = useState(false);
	const [payTimingDone, setPayTimingDone] = useState(false);
	const [draftOrder, setDraftOrder] = useState<DraftOrderRef | null>(null);
	const [payment, setPayment] = useState<PaymentIntentResponse | null>(null);
	const [preparing, setPreparing] = useState(false);
	// Client secret the mounted Payment Element has reported ready for. Keying
	// readiness to the secret (rather than a bare boolean) means a refreshed
	// PaymentIntent re-shows the skeleton, and keeps confirm disabled, until the
	// new Element fires `onReady`.
	const [readyClientSecret, setReadyClientSecret] = useState<string | null>(
		null,
	);
	const [contactError, setContactError] = useState<string | null>(null);
	const [discountPending, setDiscountPending] = useState(false);
	const [discountError, setDiscountError] = useState<string | null>(null);
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogKind>(null);
	const [savingStay, setSavingStay] = useState(false);
	// Optimistic stay shown in the summary the moment a date/guest edit is
	// confirmed, so the dialog can close and the stay rows update immediately
	// while the price re-quote settles. Cleared once the cart catches up.
	const [optimisticStay, setOptimisticStay] =
		useState<ReservationSummaryItem | null>(null);

	const bootstrapStarted = useRef(false);
	// Last profile fetched during prefill; reused so a "save to account" write
	// preserves residence/nationality the checkout form never collects.
	const accountProfileRef = useRef<AccountProfile | null>(null);

	const item = activeItemOf(cart);
	// `prepared`: a draft order exists, so the cart is frozen and any stay or
	// discount edit must rebuild a fresh cart. `hasPayment`: a PaymentIntent (or
	// zero-total response) exists, so the payment + review steps are shown.
	const prepared = draftOrder !== null;
	const hasPayment = payment !== null;
	const currency = cart?.currency ?? initialListing.currency;
	const totalLabel = cart ? formatMinor(cart.totalMinor, currency) : "";
	const pendingSummaryItem = pendingSummaryItemOf(initialStay);

	const stayKey = useMemo(
		() =>
			stayKeyToken({
				adults: initialStay.adults,
				// Dates may be absent; the bootstrap errors out before resume runs, so
				// the token value for a dateless stay is never matched against.
				checkIn: initialStay.checkIn ?? "",
				checkOut: initialStay.checkOut ?? "",
				children: initialStay.children,
				guests: initialStay.guests,
				infants: initialStay.infants,
				listingId: initialListing.id,
			}),
		[initialListing.id, initialStay],
	);

	// Same-origin path the auth pages return to after sign-in.
	const authNext = useMemo(() => {
		const query = searchParams.toString();
		return query ? `${pathname}?${query}` : pathname;
	}, [pathname, searchParams]);

	// --- Bootstrap: load or create the cart, ensure the stay item, validate. ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap must run exactly once on mount; the bootstrapStarted ref guards re-entry and the seed props are stable for the instance.
	useEffect(() => {
		if (bootstrapStarted.current) {
			return;
		}
		bootstrapStarted.current = true;

		const run = async () => {
			if (!initialStay.checkIn || !initialStay.checkOut) {
				setFatalError(
					"This booking is missing its dates. Please choose your dates on the home page.",
				);
				setPhase("error");
				return;
			}

			// Adopts a recovered draft order + PaymentIntent into checkout state,
			// keeping the Payment Element mounted on the review step.
			const applyResumedPayment = (
				resumedCart: CartDto,
				intent: PaymentIntentResponse,
			) => {
				setCart(resumedCart);
				sessionStorage.setItem(CART_STORAGE_KEY, resumedCart.id);
				setDraftOrder({
					checkoutExpiresAt: intent.checkoutExpiresAt,
					orderId: intent.orderId,
					publicReference: intent.publicReference,
				});
				setPayment(intent);
				setPayTimingDone(true);
				writeResumeState({
					cartId: resumedCart.id,
					checkoutExpiresAt: intent.checkoutExpiresAt,
					orderId: intent.orderId,
					publicReference: intent.publicReference,
					stayKey,
				});
				setNotice("Your payment step is ready. Please review your details.");
			};

			// Re-reads the payable order for a converted cart (by order id when
			// known, else resolved from the cart) and resumes payment. Returns false
			// when the order is gone/expired so the caller can restart cleanly.
			const tryResume = async (
				resumedCart: CartDto,
				orderId: string | undefined,
			): Promise<boolean> => {
				try {
					const intent = await api.createPaymentIntent({
						cartId: resumedCart.id,
						...(orderId ? { orderId } : {}),
					});
					applyResumedPayment(resumedCart, intent);
					// Repaint the contact from the order (never kept in storage).
					try {
						const { contact } = await api.getOrderContact(
							intent.publicReference,
						);
						setContact(contactDraftFromOrderContact(contact));
					} catch {
						// Best-effort: the payment step still works without the summary.
					}
					return true;
				} catch (error) {
					if (ORDER_RESTART_CODES.has(toCheckoutError(error).code)) {
						clearResumeState();
						return false;
					}
					throw error;
				}
			};

			try {
				// 1) Resume an in-progress payment for this exact stay from stored,
				//    non-secret metadata before touching the cart.
				const resume = readResumeState();
				if (resume) {
					if (isResumeUsable(resume, stayKey, Date.now())) {
						try {
							const resumedCart = (await api.getCart(resume.cartId)).cart;
							if (await tryResume(resumedCart, resume.orderId)) {
								setPhase("ready");
								return;
							}
						} catch (error) {
							if (!ORDER_RESTART_CODES.has(toCheckoutError(error).code)) {
								throw error;
							}
							clearResumeState();
						}
					} else {
						clearResumeState();
					}
				}

				// 2) Load the stored cart, if any.
				let loaded: CartDto | null = null;
				const storedId = sessionStorage.getItem(CART_STORAGE_KEY);
				if (storedId) {
					try {
						loaded = (await api.getCart(storedId)).cart;
					} catch {
						sessionStorage.removeItem(CART_STORAGE_KEY);
					}
				}

				// A stored cart already converted to an order: recover its order for
				// the same stay before discarding it (covers lost resume metadata).
				if (loaded && loaded.status === "converted") {
					const convertedItem = activeItemOf(loaded);
					const matchesStay =
						convertedItem != null &&
						stayKeyToken(stayKeyFromItem(initialListing.id, convertedItem)) ===
							stayKey;
					if (matchesStay) {
						try {
							if (await tryResume(loaded, undefined)) {
								setPhase("ready");
								return;
							}
						} catch (error) {
							if (!ORDER_RESTART_CODES.has(toCheckoutError(error).code)) {
								throw error;
							}
						}
					}
					loaded = null;
				}

				const staySeed: StayKeyInput = {
					adults: initialStay.adults,
					checkIn: initialStay.checkIn,
					checkOut: initialStay.checkOut,
					children: initialStay.children,
					guests: initialStay.guests,
					infants: initialStay.infants,
					listingId: initialListing.id,
				};
				const targetStayKey = stayKeyToken(staySeed);

				if (loaded?.status !== "draft") {
					loaded = (await api.createCart()).cart;
					sessionStorage.setItem(CART_STORAGE_KEY, loaded.id);
				}

				// `/book` books a single stay; the multi-item cart (multiple stays +
				// experiences in one purchase) is a separate, future concept. Reuse the
				// stored draft only when it already holds exactly this stay (e.g. a page
				// refresh). Otherwise start clean, so a stale stay from an earlier
				// reserve never lingers as a second active item, which would surface its
				// guest count in the summary and inflate the cart total by summing both.
				const activeItems = loaded.items.filter(
					(entry) => entry.status === "active",
				);
				const [firstActive] = activeItems;
				const alreadyExactStay =
					activeItems.length === 1 &&
					firstActive !== undefined &&
					stayKeyToken(stayKeyFromItem(initialListing.id, firstActive)) ===
						targetStayKey;

				if (!alreadyExactStay) {
					if (activeItems.length > 0) {
						loaded = (await api.createCart()).cart;
						sessionStorage.setItem(CART_STORAGE_KEY, loaded.id);
					}
					loaded = (
						await api.addCartItem(loaded.id, {
							adults: initialStay.adults,
							checkIn: initialStay.checkIn,
							checkOut: initialStay.checkOut,
							children: initialStay.children,
							clientMutationId: cartItemClientMutationId(staySeed),
							guests: initialStay.guests,
							idempotencyKey: cartItemIdempotencyKey(staySeed),
							infants: initialStay.infants,
							listingId: initialListing.id,
						})
					).cart;
				}

				const validated = await api.validateCart(loaded.id);
				setCart(validated.cart);
				if (!validated.valid) {
					handleValidationFailure(validated);
				}
				setPhase("ready");
				trackCheckoutEvent("checkout_started", {
					currency: validated.cart.currency,
					listingId: initialListing.id,
				});
			} catch (error) {
				setFatalError(toCheckoutError(error).message);
				setPhase("error");
			}
		};

		void run();
	}, []);

	// --- Prefill contact from the signed-in account, if any. Re-runs when the
	// session changes (e.g. after signing in through the auth overlay). ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on sessionUserId; the setters and `api` are stable.
	useEffect(() => {
		let cancelled = false;
		accountProfileRef.current = null;
		const loadMe = async () => {
			try {
				const response = await fetch("/api/me");
				if (!response.ok) {
					if (!cancelled) {
						setSignedIn(false);
						accountProfileRef.current = null;
					}
					return;
				}
				const me = (await response.json()) as {
					email?: string;
					name?: string;
				};
				if (cancelled) {
					return;
				}
				setSignedIn(true);
				setContact((current) => ({
					...current,
					email: current.email || me.email || "",
					name: current.name || me.name || "",
				}));
				if (me.email || me.name) {
					setContactPrefilled(true);
				}
				// Link any anonymous cart to the account (idempotent; the sign-in hook
				// also does this, so failures here are non-fatal).
				void api.claimCart().catch(() => undefined);

				// Prefill the saved phone/billing details from the account profile.
				const profileResponse = await fetch("/api/account/profile");
				if (!profileResponse.ok || cancelled) {
					accountProfileRef.current = null;
					return;
				}
				const profile = (await profileResponse.json()) as AccountProfile;
				if (cancelled) {
					return;
				}
				accountProfileRef.current = profile;
				setContact((current) => applyProfileToContactDraft(current, profile));
				if (
					profile.phoneE164 ||
					profile.companyName ||
					profile.taxNumber ||
					hasBillingDetails(
						applyProfileToContactDraft(emptyContactDraft(), profile),
					)
				) {
					setContactPrefilled(true);
				}
			} catch {
				// Anonymous checkout is fine; ignore.
				if (!cancelled) {
					accountProfileRef.current = null;
				}
			}
		};
		void loadMe();
		return () => {
			cancelled = true;
		};
	}, [sessionUserId]);

	const clientSecret =
		payment?.kind === "payment_intent" ? payment.clientSecret : null;
	// Ready only once the Element has reported `onReady` for the *current*
	// secret; a refreshed PaymentIntent remounts Elements, so readiness (and the
	// skeleton overlay) tracks the live secret rather than lingering from a
	// previous one.
	const paymentElementReady =
		clientSecret !== null && readyClientSecret === clientSecret;
	// Drop a stale readiness marker once payment is cleared, so a later resume
	// that happens to reuse the same secret still shows the skeleton first.
	useEffect(() => {
		if (clientSecret === null) {
			setReadyClientSecret(null);
		}
	}, [clientSecret]);

	const preparationMessage = usePendingMessages(
		preparing && !payment,
		PAYMENT_PREPARATION_MESSAGES,
		4500,
	);
	const paymentElementMessage = usePendingMessages(
		payment?.kind === "payment_intent" && !paymentElementReady,
		PAYMENT_ELEMENT_MESSAGES,
		4500,
	);

	const handleValidationFailure = useCallback(
		(result: CartValidationResponse) => {
			const failure = result.failures[0];
			if (!failure) {
				return;
			}
			setNotice(failure.message);
			if (/date|unavailable|quote/i.test(failure.code)) {
				setDialog("dates");
			}
		},
		[],
	);

	const buildContactInput = useCallback((): api.CheckoutContactInput => {
		const address: api.CheckoutBillingAddress = {};
		if (contact.line1.trim()) address.line1 = contact.line1.trim();
		if (contact.line2.trim()) address.line2 = contact.line2.trim();
		if (contact.city.trim()) address.city = contact.city.trim();
		if (contact.region.trim()) address.region = contact.region.trim();
		if (contact.postalCode.trim())
			address.postalCode = contact.postalCode.trim();
		if (contact.country.trim()) address.country = contact.country.trim();

		const hasAddress = Object.keys(address).length > 0;
		const isCompany = contact.isCompany;
		return {
			billingAddress: hasAddress ? address : undefined,
			companyName:
				isCompany && contact.companyName.trim()
					? contact.companyName.trim()
					: undefined,
			email: contact.email.trim(),
			isCompany,
			name: contact.name.trim(),
			notes: contact.notes.trim() || undefined,
			phone: contact.phone.trim(),
			taxNumber:
				isCompany && contact.taxNumber.trim()
					? contact.taxNumber.trim()
					: undefined,
		};
	}, [contact]);

	// Creates a fresh cart with the given stay (used to edit after the cart has
	// been converted by draft-order creation, which freezes the original cart).
	const rebuildCart = useCallback(
		async (stay: StayKeyInput): Promise<CartDto> => {
			const created = (await api.createCart()).cart;
			sessionStorage.setItem(CART_STORAGE_KEY, created.id);
			await api.addCartItem(created.id, {
				adults: stay.adults,
				checkIn: stay.checkIn,
				checkOut: stay.checkOut,
				children: stay.children,
				clientMutationId: cartItemClientMutationId(stay),
				guests: stay.guests,
				idempotencyKey: cartItemIdempotencyKey(stay),
				infants: stay.infants,
				listingId: stay.listingId,
			});
			const validated = await api.validateCart(created.id);
			setCart(validated.cart);
			setDraftOrder(null);
			setPayment(null);
			setReviewError(null);
			setTermsAccepted(false);
			clearResumeState();
			return validated.cart;
		},
		[],
	);

	const applyStayChange = useCallback(
		async (next: Partial<StayKeyInput>) => {
			if (!cart || !item) {
				return;
			}
			const base = stayKeyFromItem(initialListing.id, item);
			const merged: StayKeyInput = { ...base, ...next };

			// Reflect the new stay in the summary and close the dialog immediately;
			// only the price re-quote stays pending (the price rows skeleton out).
			// On failure the `finally` clears this, reverting to the cart's stay.
			const nights = nightsBetween(merged.checkIn, merged.checkOut);
			if (Number.isFinite(nights) && nights >= 1) {
				setOptimisticStay({
					adults: merged.adults,
					checkIn: merged.checkIn,
					checkOut: merged.checkOut,
					children: merged.children,
					infants: merged.infants,
					nights,
				});
			}
			setDialog(null);
			setSavingStay(true);
			setReviewError(null);
			try {
				if (prepared) {
					await rebuildCart(merged);
					setNotice(
						"Your stay was updated. Please re-enter your payment details.",
					);
				} else {
					await api.updateCartItem(cart.id, item.id, {
						adults: merged.adults,
						checkIn: merged.checkIn,
						checkOut: merged.checkOut,
						children: merged.children,
						guests: merged.guests,
						idempotencyKey: randomIdempotencyKey("stay"),
						infants: merged.infants,
					});
					const validated = await api.validateCart(cart.id);
					setCart(validated.cart);
					if (!validated.valid) {
						handleValidationFailure(validated);
					}
				}
			} catch (error) {
				setNotice(toCheckoutError(error).message);
			} finally {
				setSavingStay(false);
				setOptimisticStay(null);
			}
		},
		[
			cart,
			handleValidationFailure,
			initialListing.id,
			item,
			prepared,
			rebuildCart,
		],
	);

	const handleSaveDates = useCallback(
		(next: { checkIn: string; checkOut: string }) =>
			applyStayChange({ checkIn: next.checkIn, checkOut: next.checkOut }),
		[applyStayChange],
	);

	const handleSaveGuests = useCallback(
		(next: GuestSelection) =>
			applyStayChange({
				adults: next.adults,
				children: next.children,
				guests: capacityForGuests(next.adults, next.children),
				infants: next.infants,
			}),
		[applyStayChange],
	);

	const handleApplyDiscount = useCallback(
		async (code: string) => {
			if (!cart || !item) {
				return;
			}
			setDiscountPending(true);
			setDiscountError(null);
			try {
				let cartId = cart.id;
				if (prepared) {
					cartId = (await rebuildCart(stayKeyFromItem(initialListing.id, item)))
						.id;
				}
				const result = await api.applyDiscount(cartId, {
					code,
					idempotencyKey: randomIdempotencyKey("discount"),
				});
				setCart(result.cart);
			} catch (error) {
				setDiscountError(toCheckoutError(error).message);
			} finally {
				setDiscountPending(false);
			}
		},
		[cart, initialListing.id, item, prepared, rebuildCart],
	);

	const handleRemoveDiscount = useCallback(async () => {
		if (!cart || !item) {
			return;
		}
		setDiscountPending(true);
		setDiscountError(null);
		try {
			if (prepared) {
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
			} else {
				const result = await api.removeDiscount(cart.id);
				setCart(result.cart);
			}
		} catch (error) {
			setDiscountError(toCheckoutError(error).message);
		} finally {
			setDiscountPending(false);
		}
	}, [cart, initialListing.id, item, prepared, rebuildCart]);

	// Best-effort: persist the entered contact/billing to the account profile
	// when the guest opted in. Never blocks checkout; failures (e.g. a phone the
	// profile schema rejects) are swallowed since the order already holds the
	// contact. Residence/nationality are preserved by reloading the current
	// profile immediately before the full-replace PUT.
	const saveContactToAccount = useCallback(async () => {
		if (!signedIn || !saveToAccount) {
			return;
		}
		try {
			const profileResponse = await fetch("/api/account/profile");
			if (!profileResponse.ok) {
				accountProfileRef.current = null;
				return;
			}
			const profile = (await profileResponse.json()) as AccountProfile;
			accountProfileRef.current = profile;
			await fetch("/api/account/profile", {
				body: JSON.stringify(profileInputFromContactDraft(contact, profile)),
				headers: { "content-type": "application/json" },
				method: "PUT",
			});
		} catch {
			// Saving to the profile is a convenience; ignore failures.
		}
	}, [contact, saveToAccount, signedIn]);

	const handleContactSubmit = useCallback(async () => {
		if (!cart) {
			return;
		}
		setPreparing(true);
		setContactError(null);
		try {
			// Happy path: a single round trip freezes the cart into a draft order,
			// holds the reservation and returns the PaymentIntent. On retry (the
			// order already exists but the PaymentIntent call failed) reuse the
			// order via the granular endpoint, which skips the now-converted cart.
			let intent: PaymentIntentResponse;
			if (draftOrder) {
				// The order already exists (e.g. the guest reopened the payment step
				// to edit details): persist any contact changes before recreating the
				// intent so the order never diverges from the submitted form.
				const { contact: saved } = await api.updateOrderContact(
					draftOrder.publicReference,
					buildContactInput(),
				);
				setContact(contactDraftFromOrderContact(saved));
				intent = await api.createPaymentIntent({
					cartId: cart.id,
					orderId: draftOrder.orderId,
				});
			} else {
				intent = await api.preparePayment({
					cartId: cart.id,
					contact: buildContactInput(),
					idempotencyKey: `draft:${cart.id}`,
				});
				setDraftOrder({
					checkoutExpiresAt: intent.checkoutExpiresAt,
					orderId: intent.orderId,
					publicReference: intent.publicReference,
				});
				writeResumeState({
					cartId: cart.id,
					checkoutExpiresAt: intent.checkoutExpiresAt,
					orderId: intent.orderId,
					publicReference: intent.publicReference,
					stayKey,
				});
			}

			setPayment(intent);
			trackCheckoutEvent("payment_started", {
				amountMinor: intent.amountMinor,
				currency: intent.currency,
				kind: intent.kind,
			});
			void saveContactToAccount();
		} catch (error) {
			const err = toCheckoutError(error);
			// Reserve-first: the provider hold was rejected (dates gone) before any
			// charge, and the order was failed server-side. Rebuild a fresh cart for
			// the same stay and prompt new dates instead of stranding the guest.
			if (err.code === "reservation_unavailable" && item) {
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
				setDialog("dates");
				setNotice(err.message);
				return;
			}
			// The cached quote no longer holds: revalidation at draft-order creation
			// found the dates/price changed, so the guest must adjust before paying.
			if (
				(err.code === "quote_revalidation_failed" ||
					err.code === "dates_unavailable") &&
				item
			) {
				trackCheckoutEvent("checkout_validation_failed", {
					listingId: initialListing.id,
				});
				setDialog("dates");
				setNotice(err.message);
				return;
			}
			if (ORDER_RESTART_CODES.has(err.code) && item) {
				clearResumeState();
				setDraftOrder(null);
				setPayment(null);
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
				setNotice(
					"Your payment session expired. We refreshed your cart so you can continue.",
				);
				return;
			}
			setContactError(err.message);
		} finally {
			setPreparing(false);
		}
	}, [
		buildContactInput,
		cart,
		draftOrder,
		initialListing.id,
		saveContactToAccount,
		stayKey,
		item,
		rebuildCart,
	]);

	// Edits the contact on the existing draft order in place. The contact does
	// not affect the total, so the PaymentIntent is left untouched.
	const handleContactUpdate = useCallback(async () => {
		if (!draftOrder) {
			return;
		}
		setSavingContact(true);
		setContactError(null);
		try {
			const { contact: saved } = await api.updateOrderContact(
				draftOrder.publicReference,
				buildContactInput(),
			);
			setContact(contactDraftFromOrderContact(saved));
			setEditingContact(false);
			void saveContactToAccount();
		} catch (error) {
			setContactError(toCheckoutError(error).message);
		} finally {
			setSavingContact(false);
		}
	}, [buildContactInput, draftOrder, saveContactToAccount]);

	const validateBeforePay = useCallback(async (): Promise<boolean> => {
		if (!cart || !draftOrder || payment?.kind !== "payment_intent") {
			return false;
		}
		try {
			// The cart is frozen into the draft order, so re-read the payable order
			// and PaymentIntent server-side rather than validating the converted
			// cart. The order amount is snapshotted at draft creation; a mismatch
			// here means the intent was rebuilt, so remount and ask for review. Once
			// the intent still matches, place the provider hold before Stripe is
			// allowed to confirm payment.
			const refreshed = await api.createPaymentIntent({
				cartId: cart.id,
				orderId: draftOrder.orderId,
			});
			if (refreshed.kind !== "payment_intent") {
				setReviewError(
					"This payment session could not be confirmed. Please start again from the home.",
				);
				return false;
			}
			if (
				refreshed.amountMinor !== payment.amountMinor ||
				refreshed.currency !== payment.currency ||
				refreshed.clientSecret !== payment.clientSecret
			) {
				setPayment(refreshed);
				setReviewError(
					"Your payment details were refreshed. Please review and confirm again.",
				);
				return false;
			}
			await api.holdReservation({
				cartId: cart.id,
				orderId: draftOrder.orderId,
			});
			return true;
		} catch (error) {
			const err = toCheckoutError(error);
			trackCheckoutEvent("payment_failed", {
				listingId: initialListing.id,
			});
			// The provider hold became unavailable before charging: rebuild a fresh
			// cart for the same stay and prompt new dates.
			if (err.code === "reservation_unavailable" && item) {
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
				setDialog("dates");
				setNotice(err.message);
				return false;
			}
			// A genuinely non-payable order (expired/cancelled checkout window) can no
			// longer be charged. Rebuild a fresh, mutable cart for the same stay so the
			// guest restarts cleanly instead of being stranded on the frozen, converted
			// cart; rebuildCart clears payment/draftOrder/resume.
			if (ORDER_RESTART_CODES.has(err.code) && item) {
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
				setNotice(
					"Your payment session expired. We refreshed your cart so you can continue.",
				);
				return false;
			}
			setReviewError(err.message);
			return false;
		}
	}, [cart, draftOrder, initialListing.id, item, payment, rebuildCart]);

	const navigateToCompletion = useCallback(() => {
		if (!payment) {
			return;
		}
		router.push(
			`/booking/complete?order=${encodeURIComponent(payment.publicReference)}`,
		);
	}, [payment, router]);

	const handleZeroTotalConfirm = useCallback(async () => {
		if (!termsAccepted) {
			setReviewError("Please accept the booking terms to continue.");
			return;
		}
		if (!cart || !draftOrder) {
			return;
		}
		try {
			// Re-confirm the order is still a zero-total payable before finishing.
			const refreshed = await api.createPaymentIntent({
				cartId: cart.id,
				orderId: draftOrder.orderId,
			});
			if (refreshed.kind === "zero_total") {
				navigateToCompletion();
				return;
			}
			// The order acquired a balance (e.g. a re-quote): surface payment.
			setPayment(refreshed);
			setReviewError(
				"This booking now requires payment. Please complete the payment details below.",
			);
		} catch (error) {
			const err = toCheckoutError(error);
			if (ORDER_RESTART_CODES.has(err.code) && item) {
				await rebuildCart(stayKeyFromItem(initialListing.id, item));
				setNotice(
					"Your booking session expired. We refreshed your cart so you can continue.",
				);
				return;
			}
			setReviewError(err.message);
		}
	}, [
		cart,
		draftOrder,
		initialListing.id,
		item,
		navigateToCompletion,
		rebuildCart,
		termsAccepted,
	]);

	const returnUrl = useMemo(() => {
		if (typeof window === "undefined" || !payment) {
			return "";
		}
		return `${window.location.origin}/booking/complete?order=${encodeURIComponent(payment.publicReference)}`;
	}, [payment]);

	// --- Render ---

	if (phase === "error") {
		return (
			<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
				<h1 className="font-heading font-semibold text-xl">
					We could not start this booking
				</h1>
				<p className="text-muted-foreground text-sm">{fatalError}</p>
				<Button asChild>
					<Link href={`/homes/${initialListing.id}`}>Back to the home</Link>
				</Button>
			</div>
		);
	}

	const payTimingState = payTimingDone ? "complete" : "active";
	// Step 2 stays active through payment collection so the Stripe Payment
	// Element stays mounted until `confirmPayment` runs; it never collapses to a
	// summary mid-payment. Step 3 (review) opens below it once payment exists,
	// but hides while the guest is editing their contact details.
	const paymentState = payTimingDone ? "active" : "upcoming";
	// Show the contact form before payment, and again when editing it in place.
	// Once the guest submits their contact details, optimistically swap to the
	// payment step with a skeleton while the draft order + PaymentIntent settle in
	// the background, instead of stranding them on a disabled "Saving" button.
	const showContactForm = editingContact || (!payment && !preparing);
	const showPaymentLoading = preparing && !payment && !editingContact;
	const showReview = hasPayment && !editingContact;
	const reviewState = showReview ? "active" : "upcoming";

	// "Paying as …" row shared by the loading skeleton and the live Payment
	// Element. Editing is only possible once a draft order exists, so the button
	// is disabled while the optimistic skeleton is shown.
	const payingAsHeader = (canEdit: boolean) => (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<p className="text-muted-foreground text-sm">
				Paying as {contact.name || contact.email || "guest"}
			</p>
			<Button
				className="p-0 text-sm underline"
				disabled={!canEdit}
				onClick={canEdit ? () => setEditingContact(true) : undefined}
				variant="link"
			>
				Edit contact details
			</Button>
		</div>
	);

	const paymentBody = showContactForm ? (
		<div className="flex flex-col gap-4">
			{!signedIn && !editingContact && <CheckoutAuthPrompt next={authNext} />}
			<ContactBillingForm
				canSaveToAccount={signedIn}
				error={contactError}
				onCancel={editingContact ? () => setEditingContact(false) : undefined}
				onChange={setContact}
				onSaveToAccountChange={setSaveToAccount}
				onSubmit={editingContact ? handleContactUpdate : handleContactSubmit}
				prefilledFromAccount={editingContact ? false : contactPrefilled}
				saveToAccount={saveToAccount}
				submitLabel={editingContact ? "Save contact details" : undefined}
				submitting={editingContact ? savingContact : preparing}
				value={contact}
			/>
		</div>
	) : showPaymentLoading ? (
		<div className="flex flex-col gap-4">
			{payingAsHeader(false)}
			<PaymentLoadingStatus message={preparationMessage} />
			<div className={PAYMENT_AREA_MIN_HEIGHT}>
				<PaymentElementSkeleton />
			</div>
		</div>
	) : payment?.kind === "payment_intent" ? (
		<div className="flex flex-col gap-4">
			{payingAsHeader(true)}
			<div className={`relative ${PAYMENT_AREA_MIN_HEIGHT}`}>
				<div
					className={
						paymentElementReady ? undefined : "pointer-events-none opacity-0"
					}
				>
					<CheckoutPaymentElement
						onReady={() => {
							if (clientSecret) {
								setReadyClientSecret(clientSecret);
							}
						}}
					/>
				</div>
				{!paymentElementReady && (
					<div className="absolute inset-0 flex flex-col gap-4">
						<PaymentLoadingStatus message={paymentElementMessage} />
						<PaymentElementSkeleton />
					</div>
				)}
			</div>
		</div>
	) : (
		<CheckoutAlert variant="info" title="No payment needed">
			This booking has no balance to pay. Confirm below to finish.
		</CheckoutAlert>
	);

	const confirmSlot =
		payment?.kind === "payment_intent" ? (
			<ConfirmPayButton
				disabled={!termsAccepted || !paymentElementReady}
				onError={(message) => {
					setReviewError(message);
					trackCheckoutEvent("payment_failed", {
						listingId: initialListing.id,
					});
				}}
				onValidate={validateBeforePay}
				returnUrl={returnUrl}
				totalLabel={totalLabel}
			/>
		) : (
			<Button
				className="w-full sm:w-auto"
				disabled={!termsAccepted}
				onClick={handleZeroTotalConfirm}
				size="lg"
			>
				Confirm booking
			</Button>
		);

	const stepsTail = (
		<>
			<PaymentMethodStep onEdit={() => setPayment(null)} state={paymentState}>
				{paymentBody}
			</PaymentMethodStep>
			{showReview && (
				<ReviewReservationStep
					cancellationSummary="Free cancellation windows and refund terms follow this home's policy. The Alojamento Ideal team will share confirmation details by email."
					confirmSlot={confirmSlot}
					contactSummary={
						<span>
							{contact.name}
							{contact.email ? ` · ${contact.email}` : ""}
							{contact.phone ? ` · ${contact.phone}` : ""}
						</span>
					}
					error={reviewError}
					onEdit={() => setEditingContact(true)}
					onTermsChange={setTermsAccepted}
					paymentSummary={
						payment?.kind === "payment_intent"
							? "Secure payment via Stripe"
							: "No payment required"
					}
					state={reviewState}
					staySummary={
						item ? (
							<span>
								{formatStayRangeLong(item.checkIn, item.checkOut)} ·{" "}
								{nightsLabel(item.nights)} ·{" "}
								{guestSummaryLabel({
									adults: item.adults,
									children: item.children,
									infants: item.infants,
								})}
							</span>
						) : null
					}
					termsAccepted={termsAccepted}
				/>
			)}
		</>
	);

	const steps = (
		<>
			{notice && (
				<CheckoutAlert title="Heads up" variant="info">
					{notice}
				</CheckoutAlert>
			)}
			<PayTimingStep
				onConfirm={() => {
					setPayTimingDone(true);
					trackCheckoutEvent("checkout_step_viewed", {
						step: "payment-method",
					});
				}}
				onEdit={() => setPayTimingDone(false)}
				payNowLabel={totalLabel}
				state={payTimingState}
			/>
			{payment?.kind === "payment_intent" ? (
				// Key on the client secret: Stripe Elements cannot swap its bound secret
				// after mount, so a refreshed PaymentIntent must remount the provider.
				<StripePaymentForm
					clientSecret={payment.clientSecret}
					key={payment.clientSecret}
				>
					{stepsTail}
				</StripePaymentForm>
			) : (
				stepsTail
			)}
		</>
	);

	const hasReadyItem = cart !== null && item !== null;
	const summaryItem = item ?? (phase === "loading" ? pendingSummaryItem : null);
	const summary = (
		<ReservationSummary
			canChangeStay={hasReadyItem && !savingStay}
			canOpenPriceDetails={hasReadyItem && !savingStay}
			cart={cart}
			discountSlot={
				hasReadyItem ? (
					<DiscountCodeForm
						appliedCode={cart?.appliedDiscount?.promotionCode ?? null}
						error={discountError}
						onApply={handleApplyDiscount}
						onRemove={handleRemoveDiscount}
						pending={discountPending}
					/>
				) : null
			}
			item={optimisticStay ?? summaryItem}
			listing={initialListing}
			onChangeDates={() => setDialog("dates")}
			onChangeGuests={() => setDialog("guests")}
			onOpenCurrency={() => setDialog("currency")}
			onOpenPriceDetails={() => setDialog("price")}
			pricePending={savingStay}
		/>
	);

	return (
		<>
			<CheckoutLayout
				steps={phase === "loading" ? <CheckoutBootstrapLoading /> : steps}
				summary={summary}
			/>

			{cart && item && (
				<PriceBreakdownDialog
					cart={cart}
					item={item}
					onOpenChange={(open) => setDialog(open ? "price" : null)}
					open={dialog === "price"}
				/>
			)}
			<ChangeDatesDialog
				listingId={initialListing.id}
				minNights={initialListing.minNights}
				onOpenChange={(open) => setDialog(open ? "dates" : null)}
				onSave={handleSaveDates}
				open={dialog === "dates"}
				saving={savingStay}
				value={item ? { checkIn: item.checkIn, checkOut: item.checkOut } : null}
			/>
			<ChangeGuestsDialog
				maxGuests={initialListing.maxGuests}
				onOpenChange={(open) => setDialog(open ? "guests" : null)}
				onSave={handleSaveGuests}
				open={dialog === "guests"}
				saving={savingStay}
				value={{
					adults: item?.adults ?? initialStay.adults,
					children: item?.children ?? initialStay.children,
					infants: item?.infants ?? initialStay.infants,
				}}
			/>
			<CurrencyDialog
				currency={currency}
				onOpenChange={(open) => setDialog(open ? "currency" : null)}
				open={dialog === "currency"}
			/>
		</>
	);
}
