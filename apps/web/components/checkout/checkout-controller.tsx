"use client";

import type { AccountProfile } from "@workspace/core/account";
import type {
	AccommodationCartItemDto,
	ActivityCartItemDto,
	CartDto,
	CartItemDto,
	CartValidationResponse,
	DraftOrderActivityDetailInput,
	PaymentIntentResponse,
} from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth/client";
import { trackCheckoutEvent } from "@/lib/checkout/analytics";
import * as api from "@/lib/checkout/api-client";
import { writeCartNotice } from "@/lib/checkout/cart-notice";
import {
	CART_CHANGED_EVENT,
	cartContentFingerprint,
	clearStoredCart,
	notifyCartChanged,
	readStoredCartFingerprint,
	readStoredCartId,
	storeCartId,
} from "@/lib/checkout/cart-store";
import { toCheckoutError } from "@/lib/checkout/errors";
import {
	formatActivityDateLong,
	formatMinor,
	formatStayRangeLong,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";
import {
	type ActivityKeyInput,
	activityCartItemClientMutationId,
	cartItemClientMutationId,
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
import {
	ActivityMainContactQuestions,
	ActivityQuestionsForm,
} from "./activity-questions-form";
import { CartSummary } from "./cart-summary";
import { CheckoutAlert } from "./checkout-alert";
import { CheckoutAuthPrompt } from "./checkout-auth-prompt";
import { CheckoutLayout } from "./checkout-layout";
import { ConfirmPayButton } from "./confirm-pay-button";
import { ContactBillingForm } from "./contact-billing-form";
import { CurrencyDialog } from "./currency-dialog";
import { DiscountCodeForm } from "./discount-code-form";
import { EditStayDialog } from "./edit-stay-dialog";
import { PayTimingStep } from "./pay-timing-step";
import { CheckoutPaymentElement } from "./payment-element";
import { PaymentMethodStep } from "./payment-method-step";
import { PriceBreakdownDialog } from "./price-breakdown-dialog";
import { ReviewReservationStep } from "./review-reservation-step";
import { StripePaymentForm } from "./stripe-payment-form";
import {
	applyProfileToContactDraft,
	type CheckoutSeed,
	type ContactDraft,
	contactDraftFromOrderContact,
	emptyContactDraft,
	hasBillingDetails,
	profileInputFromContactDraft,
} from "./types";
import { useActivityBookingDetails } from "./use-activity-booking-details";
import {
	DEFAULT_LISTING_CONSTRAINTS,
	useListingConstraints,
} from "./use-listing-constraints";
import { useOptimisticStayEdits } from "./use-optimistic-stay-edits";
import { usePendingMessages } from "./use-pending-messages";

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

type DialogKind = "currency" | "price" | null;

/** Local reference to the frozen draft order; never the client secret. */
interface DraftOrderRef {
	checkoutExpiresAt: string | null;
	orderId: string;
	publicReference: string;
}

interface CheckoutControllerProps {
	/**
	 * When set (the `/homes/[id]/book` "Reserve" entry), this stay is ensured in
	 * the shared cart before checkout renders. The `/checkout` route passes null
	 * and checks out whatever the cart already holds.
	 */
	seed: CheckoutSeed | null;
}

function activeItemsOf(cart: CartDto | null): CartItemDto[] {
	return cart?.items.filter((entry) => entry.status === "active") ?? [];
}

function isStayItem(item: CartItemDto): item is AccommodationCartItemDto {
	return item.type === "accommodation";
}

function activeStayItemsOf(cart: CartDto | null): AccommodationCartItemDto[] {
	return activeItemsOf(cart).filter(isStayItem);
}

function stayInputFromItem(item: AccommodationCartItemDto): StayKeyInput {
	return {
		adults: item.adults,
		checkIn: item.checkIn,
		checkOut: item.checkOut,
		children: item.children,
		guests: item.guests,
		infants: item.infants,
		listingId: item.listingId,
		pets: item.pets,
	};
}

function activityInputFromItem(item: ActivityCartItemDto): ActivityKeyInput {
	return {
		activityDate: item.activityDate,
		activityId: item.activityId,
		participants: item.participants.map((participant) => ({
			count: participant.count,
			pricingCategoryId: participant.pricingCategoryId,
		})),
		rateId: item.rateId,
		startTimeId: item.startTimeId,
	};
}

async function addCartItemFromExisting(
	cartId: string,
	item: CartItemDto,
): Promise<CartDto> {
	if (item.type === "activity") {
		const activity = activityInputFromItem(item);
		return (
			await api.addCartItem(cartId, {
				activityDate: activity.activityDate,
				activityId: activity.activityId,
				answers: activity.answers ?? [],
				clientMutationId: activityCartItemClientMutationId(activity),
				idempotencyKey: randomIdempotencyKey("cart-item-add"),
				participants: activity.participants,
				rateId: activity.rateId ?? null,
				startTimeId: activity.startTimeId ?? null,
				type: "activity",
			})
		).cart;
	}

	const stay = stayInputFromItem(item);
	return (
		await api.addCartItem(cartId, {
			adults: stay.adults,
			checkIn: stay.checkIn,
			checkOut: stay.checkOut,
			children: stay.children,
			clientMutationId: cartItemClientMutationId(stay),
			guests: stay.guests,
			idempotencyKey: randomIdempotencyKey("cart-item-add"),
			infants: stay.infants,
			listingId: stay.listingId,
			pets: stay.pets,
		})
	).cart;
}

function cartHasStay(cart: CartDto, stayToken: string): boolean {
	return activeStayItemsOf(cart).some(
		(item) => stayKeyToken(stayInputFromItem(item)) === stayToken,
	);
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

export function CheckoutController({ seed }: CheckoutControllerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { data: session } = useSession();
	// Drives the contact prefill / cart-claim effect below so an in-overlay login
	// (the auth dialog opened from checkout) updates the booking without a reload.
	const sessionUserId = session?.user?.id ?? null;

	const [phase, setPhase] = useState<"empty" | "error" | "loading" | "ready">(
		"loading",
	);
	const [fatalError, setFatalError] = useState<string | null>(null);
	const [cart, setCart] = useState<CartDto | null>(null);
	const [failures, setFailures] = useState<Map<string, string>>(new Map());
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
	const [stayDialogItemId, setStayDialogItemId] = useState<string | null>(null);
	const [repricingItemIds, setRepricingItemIds] = useState<Set<string>>(
		new Set(),
	);
	// Set when a submit is blocked on missing activity questions, so the inline
	// form reveals which required fields still need answers.
	const [activityError, setActivityError] = useState<string | null>(null);

	// Loads the Bokun booking-question schema for any activity in the cart and
	// holds the guest's answers/pickup choices. Kept in a ref so the submit
	// handler reads the latest state without re-creating on every keystroke.
	const activityBooking = useActivityBookingDetails(cart);
	const activityBookingRef = useRef(activityBooking);
	activityBookingRef.current = activityBooking;

	const activityBookingComplete = activityBooking.isComplete;
	useEffect(() => {
		if (activityBookingComplete) {
			setActivityError(null);
		}
	}, [activityBookingComplete]);

	const buildReadyActivityDetails = useCallback(():
		| DraftOrderActivityDetailInput[]
		| null => {
		const activity = activityBookingRef.current;
		if (!activity.hasActivities) {
			setActivityError(null);
			return [];
		}
		if (activity.loading) {
			setActivityError(
				"Just a moment while we load your activity booking options.",
			);
			return null;
		}
		if (activity.hasError) {
			setActivityError(
				"We couldn't load the activity booking questions. Please retry above.",
			);
			return null;
		}
		if (!activity.isComplete) {
			setActivityError(
				"Please complete the activity details above before continuing.",
			);
			return null;
		}
		setActivityError(null);
		return activity.buildActivityDetails();
	}, []);

	const bootstrapStarted = useRef(false);
	// Fingerprint of the cart last reconciled here, so the external-change
	// listener tells our own inline edits apart from changes made elsewhere.
	const lastAppliedFingerprintRef = useRef<string>("");
	const repricingRef = useRef(repricingItemIds);
	repricingRef.current = repricingItemIds;
	// Last profile fetched during prefill; reused so a "save to account" write
	// preserves residence/nationality the checkout form never collects.
	const accountProfileRef = useRef<AccountProfile | null>(null);

	const items = activeItemsOf(cart);
	// `prepared`: a draft order exists, so the cart is frozen and any cart or
	// discount edit must rebuild a fresh cart. `hasPayment`: a PaymentIntent (or
	// zero-total response) exists, so the payment + review steps are shown.
	const prepared = draftOrder !== null;
	const hasPayment = payment !== null;
	const currency = cart?.currency ?? "EUR";
	const totalLabel = cart ? formatMinor(cart.totalMinor, currency) : "";
	const hasFailures = failures.size > 0;
	const stayItems = useMemo(() => activeStayItemsOf(cart), [cart]);

	// Same-origin path the auth pages return to after sign-in.
	const authNext = useMemo(() => {
		const query = searchParams.toString();
		return query ? `${pathname}?${query}` : pathname;
	}, [pathname, searchParams]);

	const applyValidation = useCallback((validated: CartValidationResponse) => {
		lastAppliedFingerprintRef.current = cartContentFingerprint(validated.cart);
		setCart(validated.cart);
		notifyCartChanged(validated.cart);
		setFailures(
			new Map(
				validated.failures.map((failure) => [failure.itemId, failure.message]),
			),
		);
		const first = validated.failures[0];
		setNotice(first ? first.message : null);
	}, []);

	// Keeps the header badge in step with an optimistic edit while syncing the
	// applied fingerprint so the cart-changed listener treats the broadcast as our
	// own edit instead of re-reading and rolling it back.
	const notifyOptimisticCart = useCallback((next: CartDto) => {
		lastAppliedFingerprintRef.current = cartContentFingerprint(next);
		notifyCartChanged(next);
	}, []);

	const stayEdits = useOptimisticStayEdits({
		applyValidated: applyValidation,
		cart,
		onError: setNotice,
		onOptimisticCart: notifyOptimisticCart,
		setCart,
		setRepricingItemIds,
	});

	const listingConstraints = useListingConstraints(
		stayItems.map((item) => item.listingId),
	);

	/**
	 * Creates a fresh mutable cart holding the given items. Used when the current
	 * cart is frozen (converted into a draft order) and must be edited or retried.
	 * Items whose selection went unavailable in the meantime are skipped rather than
	 * failing the whole rebuild; the caller reports which items were dropped.
	 */
	const rebuildCartFromItems = useCallback(
		async (
			itemsToRebuild: CartItemDto[],
		): Promise<{ cart: CartDto; skippedItems: CartItemDto[] }> => {
			const created = (await api.createCart()).cart;
			storeCartId(created.id);
			const skippedItems: CartItemDto[] = [];
			for (const item of itemsToRebuild) {
				try {
					await addCartItemFromExisting(created.id, item);
				} catch {
					skippedItems.push(item);
				}
			}
			const validated = await api.validateCart(created.id);
			applyValidation(validated);
			setDraftOrder(null);
			setPayment(null);
			setReviewError(null);
			setTermsAccepted(false);
			clearResumeState();
			return { cart: validated.cart, skippedItems };
		},
		[applyValidation],
	);

	/** Rebuilds a mutable cart from the current (frozen) cart's active items. */
	const rebuildCurrentCart = useCallback(async (): Promise<{
		cart: CartDto;
		skippedItems: CartItemDto[];
	} | null> => {
		if (items.length === 0) {
			return null;
		}
		return rebuildCartFromItems(items);
	}, [items, rebuildCartFromItems]);

	// --- Bootstrap: resume a payable order, or converge the shared cart and the
	// seeded stay (when arriving from "Reserve"), then validate. ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap must run exactly once on mount; the bootstrapStarted ref guards re-entry and the seed prop is stable for the instance.
	useEffect(() => {
		if (bootstrapStarted.current) {
			return;
		}
		bootstrapStarted.current = true;

		const run = async () => {
			if (seed && (!seed.checkIn || !seed.checkOut)) {
				setFatalError(
					"This booking is missing its dates. Please choose your dates on the home page.",
				);
				setPhase("error");
				return;
			}
			const seedStay: StayKeyInput | null =
				seed?.checkIn && seed.checkOut
					? {
							adults: seed.adults,
							checkIn: seed.checkIn,
							checkOut: seed.checkOut,
							children: seed.children,
							guests: seed.guests,
							infants: seed.infants,
							listingId: seed.listingId,
							pets: seed.pets,
						}
					: null;
			const seedToken = seedStay ? stayKeyToken(seedStay) : null;

			// Adopts a recovered draft order + PaymentIntent into checkout state,
			// keeping the Payment Element mounted on the review step.
			const applyResumedPayment = (
				resumedCart: CartDto,
				intent: PaymentIntentResponse,
			) => {
				setCart(resumedCart);
				storeCartId(resumedCart.id);
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
				const storedId = readStoredCartId();

				// 1) Resume an in-progress payment from stored, non-secret metadata
				//    before touching the cart. Only when it still points at the shared
				//    cart (a later cart replaces it) and, when a stay was seeded, the
				//    resumed order actually contains that stay.
				const resume = readResumeState();
				if (resume) {
					const matchesSharedCart =
						storedId === null || storedId === resume.cartId;
					if (matchesSharedCart && isResumeUsable(resume, Date.now())) {
						try {
							const resumedCart = (await api.getCart(resume.cartId)).cart;
							if (
								(seedToken === null || cartHasStay(resumedCart, seedToken)) &&
								(await tryResume(resumedCart, resume.orderId))
							) {
								setPhase("ready");
								return;
							}
						} catch (error) {
							if (!ORDER_RESTART_CODES.has(toCheckoutError(error).code)) {
								throw error;
							}
							clearResumeState();
						}
					} else if (!matchesSharedCart) {
						clearResumeState();
					}
				}

				// 2) Load the shared cart, if any. Keep a converted cart around long
				//    enough to recover its payable order (covers lost resume metadata).
				let loaded: CartDto | null = null;
				if (storedId) {
					try {
						loaded = (await api.getCart(storedId)).cart;
					} catch {
						clearStoredCart();
					}
				}

				// Items to carry into a fresh cart when the stored one is frozen.
				let carryItems: CartItemDto[] = [];
				if (loaded && loaded.status === "converted") {
					if (seedToken === null || cartHasStay(loaded, seedToken)) {
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
					carryItems = activeItemsOf(loaded);
					loaded = null;
				}

				if (loaded?.status !== "draft") {
					loaded = (await api.createCart()).cart;
					storeCartId(loaded.id);
				}

				let seedOverlapNotice: string | null = null;
				for (const item of carryItems) {
					try {
						loaded = await addCartItemFromExisting(loaded.id, item);
					} catch {
						// A carried item whose selection went unavailable is dropped; the
						// validation notice below covers the rest.
					}
				}

				if (seedStay && seedToken && !cartHasStay(loaded, seedToken)) {
					try {
						loaded = (
							await api.addCartItem(loaded.id, {
								adults: seedStay.adults,
								checkIn: seedStay.checkIn,
								checkOut: seedStay.checkOut,
								children: seedStay.children,
								clientMutationId: cartItemClientMutationId(seedStay),
								guests: seedStay.guests,
								idempotencyKey: randomIdempotencyKey("cart-item-add"),
								infants: seedStay.infants,
								listingId: seedStay.listingId,
								pets: seedStay.pets,
							})
						).cart;
					} catch (error) {
						const err = toCheckoutError(error);
						if (err.code !== "cart_item_overlap") {
							throw err;
						}
						seedOverlapNotice = err.message;
					}
				}

				if (activeItemsOf(loaded).length === 0) {
					setCart(loaded);
					notifyCartChanged(loaded);
					setPhase("empty");
					return;
				}

				applyValidation(await api.validateCart(loaded.id));
				if (seedOverlapNotice) {
					setNotice(seedOverlapNotice);
				}
				setPhase("ready");
				trackCheckoutEvent("checkout_started", {
					currency: loaded.currency,
					itemCount: activeItemsOf(loaded).length,
					...(seedStay ? { listingId: seedStay.listingId } : {}),
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

	// Refresh the cart in place when it changed elsewhere (the /cart page in
	// another tab, or a revived checkout route). Only while the cart is still
	// mutable and no inline edit is mid-flight; a frozen (prepared) cart or an
	// in-flight edit reconciles through its own path. Keying the route on cart id
	// (not content) means this never remounts mid-edit.
	useEffect(() => {
		const onChanged = () => {
			if (prepared || phase !== "ready" || repricingRef.current.size > 0) {
				return;
			}
			if (readStoredCartFingerprint() === lastAppliedFingerprintRef.current) {
				return;
			}
			const storedId = readStoredCartId();
			if (!storedId) {
				return;
			}
			void (async () => {
				try {
					applyValidation(await api.validateCart(storedId));
				} catch {
					// Best-effort refresh; the existing cart stays on screen.
				}
			})();
		};

		window.addEventListener(CART_CHANGED_EVENT, onChanged);
		window.addEventListener("storage", onChanged);
		// With cacheComponents, Next.js hides visited routes inside React
		// `<Activity>`; hidden effects are torn down, so cart changes fired while
		// this route was hidden never reach the listeners above. Effects re-run on
		// reveal, so this immediate call replays whatever was missed; the
		// fingerprint guard inside `onChanged` makes it a no-op otherwise.
		onChanged();
		return () => {
			window.removeEventListener(CART_CHANGED_EVENT, onChanged);
			window.removeEventListener("storage", onChanged);
		};
	}, [applyValidation, prepared, phase]);

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

	const handleApplyDiscount = useCallback(
		async (code: string) => {
			if (!cart) {
				return;
			}
			setDiscountPending(true);
			setDiscountError(null);
			try {
				let cartId = cart.id;
				if (prepared) {
					const rebuilt = await rebuildCurrentCart();
					if (!rebuilt) {
						return;
					}
					cartId = rebuilt.cart.id;
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
		[cart, prepared, rebuildCurrentCart],
	);

	const handleRemoveDiscount = useCallback(async () => {
		if (!cart) {
			return;
		}
		setDiscountPending(true);
		setDiscountError(null);
		try {
			if (prepared) {
				await rebuildCurrentCart();
			} else {
				const result = await api.removeDiscount(cart.id);
				setCart(result.cart);
			}
		} catch (error) {
			setDiscountError(toCheckoutError(error).message);
		} finally {
			setDiscountPending(false);
		}
	}, [cart, prepared, rebuildCurrentCart]);

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

	/**
	 * Recovers from an item that failed at draft/hold time: rebuild a fresh
	 * mutable cart from the frozen one (dropping items that no longer quote),
	 * hand the failure message to the cart page, and send the guest there. The
	 * cart page shows the message, names any items the rebuild dropped, and
	 * flags the remaining failures inline with edit controls.
	 */
	const recoverToCart = useCallback(
		async (message: string) => {
			const rebuilt = await rebuildCurrentCart();
			const removedTitles = (rebuilt?.skippedItems ?? []).map(
				(item) => item.title,
			);
			writeCartNotice({ message, removedTitles });
			router.push("/cart");
		},
		[rebuildCurrentCart, router],
	);

	const handleContactSubmit = useCallback(async () => {
		if (!cart) {
			return;
		}
		if (hasFailures) {
			setContactError(
				"Some stays in your cart need attention. Please review your cart before paying.",
			);
			return;
		}
		// Activity holds need the guest's Bokun questions/pickup places, collected
		// inline above. They are saved on draft creation and updated in place when
		// the guest reopens details after the payment step is ready.
		const activityDetails = buildReadyActivityDetails();
		if (!activityDetails) {
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
				// to edit details): persist contact and activity changes before
				// recreating the intent so the order never diverges from the submitted
				// form.
				const { contact: saved } = await api.updateOrderContact(
					draftOrder.publicReference,
					buildContactInput(),
				);
				setContact(contactDraftFromOrderContact(saved));
				if (activityDetails.length > 0) {
					await api.updateOrderActivityDetails(
						draftOrder.publicReference,
						activityDetails,
					);
				}
				intent = await api.createPaymentIntent({
					cartId: cart.id,
					orderId: draftOrder.orderId,
				});
			} else {
				intent = await api.preparePayment({
					activityDetails: activityDetails.length ? activityDetails : undefined,
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
			// Reserve-first: a provider hold was rejected (dates gone) before any
			// charge, and the order was failed server-side. Rebuild a fresh cart
			// and let the guest fix the affected stay on the cart page.
			if (err.code === "reservation_unavailable") {
				await recoverToCart(err.message);
				return;
			}
			// The cached quote no longer holds: revalidation at draft-order creation
			// found the dates/price changed. The cart is still mutable, so re-run
			// validation to flag the affected stays.
			if (
				err.code === "quote_revalidation_failed" ||
				err.code === "dates_unavailable"
			) {
				trackCheckoutEvent("checkout_validation_failed", {
					itemCount: items.length,
				});
				try {
					applyValidation(await api.validateCart(cart.id));
				} catch {
					// The notice below still explains what happened.
				}
				setNotice(err.message);
				return;
			}
			if (ORDER_RESTART_CODES.has(err.code)) {
				clearResumeState();
				setDraftOrder(null);
				setPayment(null);
				await rebuildCurrentCart();
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
		applyValidation,
		buildContactInput,
		buildReadyActivityDetails,
		cart,
		draftOrder,
		hasFailures,
		items.length,
		rebuildCurrentCart,
		recoverToCart,
		saveContactToAccount,
	]);

	// Edits contact and activity answers on the existing draft order in place.
	// These details do not affect the total, so the PaymentIntent is left intact.
	const handleContactUpdate = useCallback(async () => {
		if (!draftOrder) {
			return;
		}
		const activityDetails = buildReadyActivityDetails();
		if (!activityDetails) {
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
			if (activityDetails.length > 0) {
				await api.updateOrderActivityDetails(
					draftOrder.publicReference,
					activityDetails,
				);
			}
			setEditingContact(false);
			void saveContactToAccount();
		} catch (error) {
			setContactError(toCheckoutError(error).message);
		} finally {
			setSavingContact(false);
		}
	}, [
		buildContactInput,
		buildReadyActivityDetails,
		draftOrder,
		saveContactToAccount,
	]);

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
					"This payment session could not be confirmed. Please start again from your cart.",
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
			const hold = await api.holdReservation({
				cartId: cart.id,
				orderId: draftOrder.orderId,
			});
			setDraftOrder({
				checkoutExpiresAt: hold.checkoutExpiresAt,
				orderId: hold.orderId,
				publicReference: hold.publicReference,
			});
			writeResumeState({
				cartId: cart.id,
				checkoutExpiresAt: hold.checkoutExpiresAt,
				orderId: hold.orderId,
				publicReference: hold.publicReference,
			});
			return true;
		} catch (error) {
			const err = toCheckoutError(error);
			trackCheckoutEvent("payment_failed", {
				itemCount: items.length,
			});
			// The provider hold became unavailable before charging: rebuild a fresh
			// cart and let the guest fix the affected stay on the cart page.
			if (err.code === "reservation_unavailable") {
				await recoverToCart(err.message);
				return false;
			}
			if (err.code === "activity_details_invalid") {
				setActivityError(err.message);
				setEditingContact(true);
				setReviewError(null);
				return false;
			}
			// A genuinely non-payable order (expired/cancelled checkout window) can no
			// longer be charged. Rebuild a fresh, mutable cart with the same stays so
			// the guest restarts cleanly instead of being stranded on the frozen,
			// converted cart; rebuildCurrentCart clears payment/draftOrder/resume.
			if (ORDER_RESTART_CODES.has(err.code)) {
				await rebuildCurrentCart();
				setNotice(
					"Your payment session expired. We refreshed your cart so you can continue.",
				);
				return false;
			}
			setReviewError(err.message);
			return false;
		}
	}, [
		cart,
		draftOrder,
		items.length,
		payment,
		rebuildCurrentCart,
		recoverToCart,
	]);

	const navigateToCompletion = useCallback(() => {
		if (!payment) {
			return;
		}
		// The cart is converted into the order at this point; drop the stored id
		// so the header badge zeroes and the next visit starts a fresh cart.
		clearStoredCart();
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
			if (ORDER_RESTART_CODES.has(err.code)) {
				await rebuildCurrentCart();
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
		navigateToCompletion,
		rebuildCurrentCart,
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
					<Link href={seed ? `/homes/${seed.listingId}` : "/homes"}>
						{seed ? "Back to the home" : "Browse homes"}
					</Link>
				</Button>
			</div>
		);
	}

	if (phase === "empty") {
		return (
			<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
				<ShoppingCart className="size-10 text-muted-foreground" />
				<h1 className="font-heading font-semibold text-xl">
					Your cart is empty
				</h1>
				<p className="text-muted-foreground text-sm">
					Find a home you love and add your stay to book it here.
				</p>
				<Button asChild>
					<Link href="/homes">Browse homes</Link>
				</Button>
			</div>
		);
	}

	const multipleStays = items.length > 1;
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
	const editDetailsLabel = activityBooking.hasActivities
		? "Edit details"
		: "Edit contact details";
	const saveDetailsLabel = activityBooking.hasActivities
		? "Save details"
		: "Save contact details";

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
				{editDetailsLabel}
			</Button>
		</div>
	);

	const paymentBody = showContactForm ? (
		<div className="flex flex-col gap-4">
			{!signedIn && !editingContact && <CheckoutAuthPrompt next={authNext} />}
			{activityBooking.hasActivities && (
				<ActivityQuestionsForm
					booking={activityBooking}
					showErrors={activityError !== null}
				/>
			)}
			{activityError && (
				<p className="text-destructive text-sm">{activityError}</p>
			)}
			{activityBooking.hasActivities && (
				<div className="flex flex-col gap-3 pt-1">
					<Separator />
					<h2 className="font-medium text-base">Main contact details</h2>
				</div>
			)}
			<ContactBillingForm
				canSaveToAccount={signedIn}
				error={contactError}
				extraFields={
					activityBooking.hasActivities ? (
						<ActivityMainContactQuestions
							booking={activityBooking}
							showErrors={activityError !== null}
						/>
					) : undefined
				}
				onCancel={editingContact ? () => setEditingContact(false) : undefined}
				onChange={setContact}
				onSaveToAccountChange={setSaveToAccount}
				onSubmit={editingContact ? handleContactUpdate : handleContactSubmit}
				prefilledFromAccount={editingContact ? false : contactPrefilled}
				saveToAccount={saveToAccount}
				submitLabel={editingContact ? saveDetailsLabel : undefined}
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
						itemCount: items.length,
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

	const staySummary = (
		<div className="flex flex-col gap-1.5">
			{items.map((item) => {
				const summary =
					item.type === "activity"
						? `${formatActivityDateLong(item.activityDate)} · ${item.totalParticipants} ${
								item.totalParticipants === 1 ? "participant" : "participants"
							}`
						: `${formatStayRangeLong(item.checkIn, item.checkOut)} · ${nightsLabel(
								item.nights,
							)} · ${guestSummaryLabel({
								adults: item.adults,
								children: item.children,
								infants: item.infants,
								pets: item.pets,
							})}`;
				return (
					<span key={item.id}>
						{multipleStays ? `${item.title}: ` : ""}
						{summary}
					</span>
				);
			})}
		</div>
	);

	const stepsTail = (
		<>
			<PaymentMethodStep onEdit={() => setPayment(null)} state={paymentState}>
				{paymentBody}
			</PaymentMethodStep>
			{showReview && (
				<ReviewReservationStep
					cancellationSummary={
						multipleStays
							? "Free cancellation windows and refund terms follow each home's policy. The Alojamento Ideal team will share confirmation details by email."
							: "Free cancellation windows and refund terms follow this home's policy. The Alojamento Ideal team will share confirmation details by email."
					}
					confirmSlot={confirmSlot}
					contactSummary={
						<span>
							{contact.name}
							{contact.email ? ` · ${contact.email}` : ""}
							{contact.phone ? ` · ${contact.phone}` : ""}
						</span>
					}
					error={reviewError}
					multipleStays={multipleStays}
					onEdit={() => setEditingContact(true)}
					onTermsChange={setTermsAccepted}
					paymentSummary={
						payment?.kind === "payment_intent"
							? "Secure payment via Stripe"
							: "No payment required"
					}
					state={reviewState}
					staySummary={staySummary}
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
			{hasFailures && (
				<CheckoutAlert title="Some stays need attention" variant="warning">
					<span>
						A stay in your cart is no longer available as selected.{" "}
						<Link className="underline" href="/cart">
							Review your cart
						</Link>{" "}
						to fix or remove it before paying.
					</span>
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

	// Single-stay checkout edits its one stay inline (no /cart redirect); the
	// "Edit cart" link stays for multi-stay, where remove/add still live there.
	const canInlineEdit =
		!prepared &&
		phase === "ready" &&
		items.length === 1 &&
		stayItems.length === 1;
	const editStayItem = stayDialogItemId
		? (stayItems.find((item) => item.id === stayDialogItemId) ?? null)
		: null;
	const editStayConstraints = editStayItem
		? (listingConstraints.get(editStayItem.listingId) ??
			DEFAULT_LISTING_CONSTRAINTS)
		: DEFAULT_LISTING_CONSTRAINTS;

	const summary = (
		<CartSummary
			canEditCart={!prepared && phase === "ready" && items.length > 1}
			canOpenPriceDetails={phase === "ready" && items.length > 0}
			cart={phase === "loading" ? null : cart}
			discountSlot={
				phase === "ready" && items.length > 0 ? (
					<DiscountCodeForm
						appliedCode={cart?.appliedDiscount?.promotionCode ?? null}
						error={discountError}
						onApply={handleApplyDiscount}
						onRemove={handleRemoveDiscount}
						pending={discountPending}
					/>
				) : null
			}
			editableItemId={canInlineEdit ? items[0]?.id : null}
			items={items}
			onEditStay={(item) => setStayDialogItemId(item.id)}
			onOpenCurrency={() => setDialog("currency")}
			onOpenPriceDetails={() => setDialog("price")}
			repricingItemIds={repricingItemIds}
		/>
	);

	return (
		<>
			<CheckoutLayout
				steps={phase === "loading" ? <CheckoutBootstrapLoading /> : steps}
				summary={summary}
			/>

			{cart && items.length > 0 && (
				<PriceBreakdownDialog
					cart={cart}
					items={items}
					onOpenChange={(open) => setDialog(open ? "price" : null)}
					open={dialog === "price"}
				/>
			)}
			<CurrencyDialog
				currency={currency}
				onOpenChange={(open) => setDialog(open ? "currency" : null)}
				open={dialog === "currency"}
			/>
			{canInlineEdit && editStayItem && (
				<EditStayDialog
					listingId={editStayItem.listingId}
					maxGuests={editStayConstraints.maxGuests}
					minNights={editStayConstraints.minNights}
					onOpenChange={(open) => {
						if (!open) {
							setStayDialogItemId(null);
						}
					}}
					onSave={(next) => stayEdits.patchStay(editStayItem.id, next)}
					open
					value={{
						adults: editStayItem.adults,
						checkIn: editStayItem.checkIn,
						checkOut: editStayItem.checkOut,
						children: editStayItem.children,
						infants: editStayItem.infants,
						pets: editStayItem.pets,
					}}
				/>
			)}
		</>
	);
}
