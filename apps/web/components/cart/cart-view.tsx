"use client";

import type {
	AccommodationCartItemDto,
	CartDto,
	CartItemDto,
	CartValidationResponse,
} from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ShoppingCart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckoutAlert } from "@/components/checkout/checkout-alert";
import { EditStayDialog } from "@/components/checkout/edit-stay-dialog";
import {
	DEFAULT_LISTING_CONSTRAINTS,
	useListingConstraints,
} from "@/components/checkout/use-listing-constraints";
import { useOptimisticStayEdits } from "@/components/checkout/use-optimistic-stay-edits";
import * as api from "@/lib/checkout/api-client";
import {
	type CartRecoveryNotice,
	cartNoticeBody,
	takeCartNotice,
} from "@/lib/checkout/cart-notice";
import {
	CART_CHANGED_EVENT,
	cartContentFingerprint,
	clearStoredCart,
	loadStoredCart,
	notifyCartChanged,
	readStoredCartFingerprint,
} from "@/lib/checkout/cart-store";
import { toCheckoutError } from "@/lib/checkout/errors";
import {
	formatActivityDateLong,
	formatMinor,
	formatStayRangeLong,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";

function activeItems(cart: CartDto | null): CartItemDto[] {
	return cart?.items.filter((item) => item.status === "active") ?? [];
}

function isStayItem(item: CartItemDto): item is AccommodationCartItemDto {
	return item.type === "accommodation";
}

function EmptyCart() {
	return (
		<div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-16 text-center shadow-sm">
			<ShoppingCart className="size-10 text-muted-foreground" />
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-semibold text-lg">
					Your cart is empty
				</h2>
				<p className="text-muted-foreground text-sm">
					Find a home you love and add your stay to book several in one go.
				</p>
			</div>
			<Button asChild className="rounded-full">
				<Link href="/homes">Browse homes</Link>
			</Button>
		</div>
	);
}

export function CartLoading() {
	return (
		<div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
			<div className="flex flex-col gap-4">
				<Skeleton className="h-36 w-full rounded-2xl" />
				<Skeleton className="h-36 w-full rounded-2xl" />
			</div>
			<Skeleton className="h-64 w-full rounded-2xl" />
		</div>
	);
}

interface CartItemCardProps {
	failure: string | null;
	item: CartItemDto;
	onEdit?: () => void;
	onRemove: () => void;
	repricing: boolean;
}

function CartItemCard({
	failure,
	item,
	onEdit,
	onRemove,
	repricing,
}: CartItemCardProps) {
	const href =
		item.type === "activity"
			? `/activities/${item.activityId}`
			: `/homes/${item.listingId}`;
	const meta =
		item.type === "activity"
			? `${formatActivityDateLong(item.activityDate)} · ${item.totalParticipants} ${
					item.totalParticipants === 1 ? "participant" : "participants"
				}`
			: `${formatStayRangeLong(item.checkIn, item.checkOut)} · ${nightsLabel(
					item.nights,
				)}`;

	return (
		<div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
			<div className="flex gap-4">
				<Link
					aria-label={item.title}
					className="block size-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-28"
					href={href}
				>
					{item.imageUrl && (
						<Image
							alt={item.title}
							className="size-full object-cover"
							height={112}
							src={item.imageUrl}
							width={112}
						/>
					)}
				</Link>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Link
						className="line-clamp-2 font-medium text-sm hover:underline"
						href={href}
					>
						{item.title}
					</Link>
					<p className="text-muted-foreground text-sm">{meta}</p>
					{item.type === "accommodation" && (
						<p className="text-muted-foreground text-sm">
							{guestSummaryLabel({
								adults: item.adults,
								children: item.children,
								infants: item.infants,
							})}
						</p>
					)}
					{repricing ? (
						<Skeleton className="mt-auto h-5 w-24" />
					) : (
						<p className="mt-auto font-semibold text-sm">
							{formatMinor(item.totalMinor, item.currency)}
						</p>
					)}
				</div>
			</div>

			{failure && (
				<CheckoutAlert title="Needs attention" variant="warning">
					{failure}
				</CheckoutAlert>
			)}

			<div className="flex flex-wrap items-center gap-4 border-t pt-3">
				{onEdit && (
					<Button
						className="h-auto p-0 text-sm underline"
						onClick={onEdit}
						variant="link"
					>
						Edit stay
					</Button>
				)}
				<Button
					className="ml-auto h-auto p-0 text-destructive text-sm underline"
					onClick={onRemove}
					variant="link"
				>
					Remove
				</Button>
			</div>
		</div>
	);
}

/**
 * The `/cart` page body: lists every stay in the shared cart with per-item
 * edit/remove, revalidates prices on load, and hands off to the cart-driven
 * `/checkout`. Edits are optimistic: dates/guests change instantly and the
 * affected prices skeleton while the server re-quotes. Items whose dates went
 * stale are flagged inline and block checkout until fixed or removed.
 */
export function CartView() {
	const [phase, setPhase] = useState<"loading" | "ready">("loading");
	const [cart, setCart] = useState<CartDto | null>(null);
	const [failures, setFailures] = useState<Map<string, string>>(new Map());
	const [notice, setNotice] = useState<string | null>(null);
	// Failure handed off by checkout when a purchase attempt stopped early.
	const [recovery, setRecovery] = useState<CartRecoveryNotice | null>(null);
	const [dialogItemId, setDialogItemId] = useState<string | null>(null);
	const [repricingItemIds, setRepricingItemIds] = useState<Set<string>>(
		new Set(),
	);
	const bootstrapStarted = useRef(false);
	// Fingerprint of the cart last reconciled here, so the external-change
	// listener can tell our own edits apart from changes made elsewhere.
	const lastAppliedFingerprintRef = useRef<string>("");
	const repricingRef = useRef(repricingItemIds);
	const needsSkippedChangeReplayRef = useRef(false);
	repricingRef.current = repricingItemIds;

	const items = activeItems(cart);
	const stayItems = items.filter(isStayItem);
	const constraints = useListingConstraints(
		stayItems.map((item) => item.listingId),
	);

	const applyValidation = useCallback((validated: CartValidationResponse) => {
		lastAppliedFingerprintRef.current = cartContentFingerprint(validated.cart);
		setCart(validated.cart);
		notifyCartChanged(validated.cart);
		setFailures(
			new Map(
				validated.failures.map((failure) => [failure.itemId, failure.message]),
			),
		);
	}, []);

	const refreshFromStoredCart = useCallback(() => {
		const fingerprint = readStoredCartFingerprint();
		if (fingerprint === lastAppliedFingerprintRef.current) {
			return;
		}
		void (async () => {
			const loaded = await loadStoredCart({ notify: false });
			if (!loaded || activeItems(loaded).length === 0) {
				lastAppliedFingerprintRef.current = cartContentFingerprint(loaded);
				setCart(loaded);
				setFailures(new Map());
				return;
			}
			try {
				applyValidation(await api.validateCart(loaded.id));
			} catch {
				lastAppliedFingerprintRef.current = cartContentFingerprint(loaded);
				setCart(loaded);
			}
		})();
	}, [applyValidation]);

	// Broadcasts an optimistic cart to the header badge and advances the applied
	// fingerprint so the cart-changed listener below recognizes the broadcast as
	// our own edit (matching fingerprint) instead of re-reading the server cart
	// and rolling the optimistic removal back.
	const notifyOptimisticCart = useCallback((next: CartDto) => {
		lastAppliedFingerprintRef.current = cartContentFingerprint(next);
		notifyCartChanged(next);
	}, []);

	const edits = useOptimisticStayEdits({
		applyValidated: applyValidation,
		cart,
		onError: setNotice,
		onOptimisticCart: notifyOptimisticCart,
		setCart,
		setRepricingItemIds,
	});

	// Load the shared cart and revalidate quotes once per mount.
	useEffect(() => {
		if (bootstrapStarted.current) {
			return;
		}
		bootstrapStarted.current = true;

		const run = async () => {
			// Surface a purchase failure checkout handed off before it sent the
			// guest back here; read-and-clear so it shows exactly once.
			const handoff = takeCartNotice();
			if (handoff) {
				setRecovery(handoff);
			}
			const loaded = await loadStoredCart();
			if (!loaded || activeItems(loaded).length === 0) {
				lastAppliedFingerprintRef.current = cartContentFingerprint(loaded);
				setCart(loaded);
				setPhase("ready");
				return;
			}
			try {
				applyValidation(await api.validateCart(loaded.id));
			} catch (error) {
				const err = toCheckoutError(error);
				if (err.code === "cart_expired" || err.code === "cart_not_found") {
					clearStoredCart();
					setCart(null);
				} else {
					lastAppliedFingerprintRef.current = cartContentFingerprint(loaded);
					setCart(loaded);
					setNotice(err.message);
				}
			}
			setPhase("ready");
		};

		void run();
	}, [applyValidation]);

	// Refresh in place when the cart changed elsewhere (another tab, or the
	// checkout flow). Skips while an edit is in flight, since that edit's own
	// reconcile converges the view; keying the route on cart id (not content)
	// means this never remounts mid-edit.
	//
	// With cacheComponents, Next.js hides visited routes inside React
	// `<Activity>` instead of unmounting them, and hidden components have their
	// effects torn down — cart changes fired while this view was hidden are
	// missed. Effects re-run on reveal, so the immediate `onChanged()` call
	// below replays whatever was missed; the fingerprint check inside
	// `refreshFromStoredCart` makes it a no-op when nothing changed.
	useEffect(() => {
		const onChanged = () => {
			if (repricingRef.current.size > 0) {
				needsSkippedChangeReplayRef.current = true;
				return;
			}
			refreshFromStoredCart();
		};

		window.addEventListener(CART_CHANGED_EVENT, onChanged);
		window.addEventListener("storage", onChanged);
		if (phase === "ready") {
			onChanged();
		}
		return () => {
			window.removeEventListener(CART_CHANGED_EVENT, onChanged);
			window.removeEventListener("storage", onChanged);
		};
	}, [refreshFromStoredCart, phase]);

	useEffect(() => {
		if (repricingItemIds.size > 0 || !needsSkippedChangeReplayRef.current) {
			return;
		}
		needsSkippedChangeReplayRef.current = false;
		refreshFromStoredCart();
	}, [repricingItemIds, refreshFromStoredCart]);

	const dialogItem = useMemo(
		() =>
			dialogItemId
				? (stayItems.find((item) => item.id === dialogItemId) ?? null)
				: null,
		[dialogItemId, stayItems],
	);
	const dialogConstraints = dialogItem
		? (constraints.get(dialogItem.listingId) ?? DEFAULT_LISTING_CONSTRAINTS)
		: DEFAULT_LISTING_CONSTRAINTS;

	if (phase === "loading") {
		return <CartLoading />;
	}

	const recoveryAlert = recovery ? (
		<CheckoutAlert title="We could not complete your booking" variant="error">
			{cartNoticeBody(recovery)}
		</CheckoutAlert>
	) : null;

	if (!cart || items.length === 0) {
		// Keep the failure visible even when the rebuild dropped every stay,
		// otherwise the guest lands on an empty cart with no explanation.
		return recoveryAlert ? (
			<div className="flex flex-col gap-4">
				{recoveryAlert}
				<EmptyCart />
			</div>
		) : (
			<EmptyCart />
		);
	}

	const hasFailures = failures.size > 0;
	const isRepricing = repricingItemIds.size > 0;

	return (
		<div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
			<div className="flex flex-col gap-4">
				{recoveryAlert}
				{notice && (
					<CheckoutAlert title="Heads up" variant="info">
						{notice}
					</CheckoutAlert>
				)}
				{items.map((item) => (
					<CartItemCard
						failure={failures.get(item.id) ?? null}
						item={item}
						key={item.id}
						onEdit={
							item.type === "accommodation"
								? () => setDialogItemId(item.id)
								: undefined
						}
						onRemove={() => edits.removeStay(item.id)}
						repricing={repricingItemIds.has(item.id)}
					/>
				))}
			</div>

			<aside className="lg:sticky lg:top-24 lg:self-start">
				<div className="rounded-2xl border bg-card p-5 shadow-sm">
					<h2 className="font-heading font-semibold text-lg">Summary</h2>
					<Separator className="my-4" />
					{isRepricing ? (
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-4 w-16" />
							</div>
							<Separator className="my-1" />
							<div className="flex items-center justify-between">
								<Skeleton className="h-5 w-16" />
								<Skeleton className="h-5 w-20" />
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-2 text-sm">
							<div className="flex items-center justify-between text-muted-foreground">
								<span>
									{items.length} {items.length === 1 ? "item" : "items"}
								</span>
								<span>{formatMinor(cart.subtotalMinor, cart.currency)}</span>
							</div>
							{cart.taxMinor > 0 && (
								<div className="flex items-center justify-between text-muted-foreground">
									<span>Taxes</span>
									<span>{formatMinor(cart.taxMinor, cart.currency)}</span>
								</div>
							)}
							{cart.discountMinor > 0 && (
								<div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
									<span>Discount</span>
									<span>-{formatMinor(cart.discountMinor, cart.currency)}</span>
								</div>
							)}
							<Separator className="my-1" />
							<div className="flex items-center justify-between font-semibold text-base">
								<span>Total</span>
								<span>{formatMinor(cart.totalMinor, cart.currency)}</span>
							</div>
						</div>
					)}

					{hasFailures && (
						<p className="mt-3 text-amber-700 text-sm dark:text-amber-300">
							Fix or remove the flagged stays to continue to checkout.
						</p>
					)}

					<Button
						asChild={!hasFailures && !isRepricing}
						className="mt-4 w-full rounded-full"
						disabled={hasFailures || isRepricing}
						size="lg"
					>
						{hasFailures || isRepricing ? (
							<span>Continue to checkout</span>
						) : (
							<Link href="/checkout">Continue to checkout</Link>
						)}
					</Button>
					<p className="mt-3 text-center text-muted-foreground text-xs">
						You will not be charged yet.
					</p>
				</div>
			</aside>

			{dialogItem && (
				<EditStayDialog
					listingId={dialogItem.listingId}
					maxGuests={dialogConstraints.maxGuests}
					minNights={dialogConstraints.minNights}
					onOpenChange={(open) => {
						if (!open) {
							setDialogItemId(null);
						}
					}}
					onSave={(next) => edits.patchStay(dialogItem.id, next)}
					open
					value={{
						adults: dialogItem.adults,
						checkIn: dialogItem.checkIn,
						checkOut: dialogItem.checkOut,
						children: dialogItem.children,
						infants: dialogItem.infants,
					}}
				/>
			)}
		</div>
	);
}
