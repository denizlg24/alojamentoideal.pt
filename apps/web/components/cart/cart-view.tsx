"use client";

import type {
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
import { useCallback, useEffect, useRef, useState } from "react";
import { ChangeDatesDialog } from "@/components/checkout/change-dates-dialog";
import {
	ChangeGuestsDialog,
	type GuestSelection,
} from "@/components/checkout/change-guests-dialog";
import { CheckoutAlert } from "@/components/checkout/checkout-alert";
import { capacityForGuests } from "@/lib/catalog/guests";
import * as api from "@/lib/checkout/api-client";
import {
	clearStoredCart,
	loadStoredCart,
	notifyCartChanged,
} from "@/lib/checkout/cart-store";
import { toCheckoutError } from "@/lib/checkout/errors";
import {
	formatMinor,
	formatStayRangeLong,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";
import { randomIdempotencyKey } from "@/lib/checkout/idempotency";

/** Listing facts the edit dialogs need, fetched once per listing in the cart. */
interface ListingConstraints {
	maxGuests: number | null;
	minNights: number;
}

const DEFAULT_CONSTRAINTS: ListingConstraints = {
	maxGuests: null,
	minNights: 1,
};

interface ItemDialog {
	itemId: string;
	kind: "dates" | "guests";
}

function activeItems(cart: CartDto | null): CartItemDto[] {
	return cart?.items.filter((item) => item.status === "active") ?? [];
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

function CartLoading() {
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
	onChangeDates: () => void;
	onChangeGuests: () => void;
	onRemove: () => void;
	pending: boolean;
}

function CartItemCard({
	failure,
	item,
	onChangeDates,
	onChangeGuests,
	onRemove,
	pending,
}: CartItemCardProps) {
	return (
		<div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
			<div className="flex gap-4">
				<Link
					aria-label={item.title}
					className="block size-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-28"
					href={`/homes/${item.listingId}`}
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
						href={`/homes/${item.listingId}`}
					>
						{item.title}
					</Link>
					<p className="text-muted-foreground text-sm">
						{formatStayRangeLong(item.checkIn, item.checkOut)} ·{" "}
						{nightsLabel(item.nights)}
					</p>
					<p className="text-muted-foreground text-sm">
						{guestSummaryLabel({
							adults: item.adults,
							children: item.children,
							infants: item.infants,
						})}
					</p>
					<p className="mt-auto font-semibold text-sm">
						{formatMinor(item.totalMinor, item.currency)}
					</p>
				</div>
			</div>

			{failure && (
				<CheckoutAlert title="Needs attention" variant="warning">
					{failure}
				</CheckoutAlert>
			)}

			<div className="flex flex-wrap items-center gap-4 border-t pt-3">
				<Button
					className="h-auto p-0 text-sm underline"
					disabled={pending}
					onClick={onChangeDates}
					variant="link"
				>
					Change dates
				</Button>
				<Button
					className="h-auto p-0 text-sm underline"
					disabled={pending}
					onClick={onChangeGuests}
					variant="link"
				>
					Change guests
				</Button>
				<Button
					className="ml-auto h-auto p-0 text-destructive text-sm underline"
					disabled={pending}
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
 * `/checkout`. Items whose dates went stale are flagged inline and block
 * checkout until fixed or removed.
 */
export function CartView() {
	const [phase, setPhase] = useState<"loading" | "ready">("loading");
	const [cart, setCart] = useState<CartDto | null>(null);
	const [failures, setFailures] = useState<Map<string, string>>(new Map());
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<ItemDialog | null>(null);
	const [pendingItemId, setPendingItemId] = useState<string | null>(null);
	const [constraints, setConstraints] = useState<
		Map<string, ListingConstraints>
	>(new Map());
	const bootstrapStarted = useRef(false);

	const applyValidation = useCallback((validated: CartValidationResponse) => {
		setCart(validated.cart);
		notifyCartChanged(validated.cart);
		setFailures(
			new Map(
				validated.failures.map((failure) => [failure.itemId, failure.message]),
			),
		);
	}, []);

	// Load the shared cart and revalidate quotes once per mount.
	// biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap runs exactly once; the ref guards re-entry.
	useEffect(() => {
		if (bootstrapStarted.current) {
			return;
		}
		bootstrapStarted.current = true;

		const run = async () => {
			const loaded = await loadStoredCart();
			if (!loaded || activeItems(loaded).length === 0) {
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
					setCart(loaded);
					setNotice(err.message);
				}
			}
			setPhase("ready");
		};

		void run();
	}, []);

	// Fetch the edit-dialog constraints once per unique listing in the cart.
	useEffect(() => {
		const listingIds = [
			...new Set(activeItems(cart).map((item) => item.listingId)),
		].filter((listingId) => !constraints.has(listingId));
		if (listingIds.length === 0) {
			return;
		}
		let cancelled = false;
		const run = async () => {
			const loaded = await Promise.all(
				listingIds.map(
					async (listingId): Promise<[string, ListingConstraints]> => {
						try {
							const response = await fetch(
								`/api/catalog/listings/${encodeURIComponent(listingId)}`,
							);
							if (!response.ok) {
								return [listingId, DEFAULT_CONSTRAINTS];
							}
							const payload = (await response.json()) as {
								data?: { capacity?: { guests?: number }; minNights?: number };
							};
							return [
								listingId,
								{
									maxGuests: payload.data?.capacity?.guests ?? null,
									minNights: payload.data?.minNights ?? 1,
								},
							];
						} catch {
							return [listingId, DEFAULT_CONSTRAINTS];
						}
					},
				),
			);
			if (!cancelled) {
				setConstraints((current) => new Map([...current, ...loaded]));
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [cart, constraints]);

	const mutateItem = useCallback(
		async (itemId: string, mutation: () => Promise<unknown>) => {
			if (!cart) {
				return;
			}
			setPendingItemId(itemId);
			setNotice(null);
			try {
				await mutation();
				applyValidation(await api.validateCart(cart.id));
			} catch (error) {
				setNotice(toCheckoutError(error).message);
			} finally {
				setPendingItemId(null);
				setDialog(null);
			}
		},
		[applyValidation, cart],
	);

	const handleSaveDates = useCallback(
		(itemId: string, next: { checkIn: string; checkOut: string }) => {
			if (!cart) {
				return;
			}
			void mutateItem(itemId, () =>
				api.updateCartItem(cart.id, itemId, {
					checkIn: next.checkIn,
					checkOut: next.checkOut,
					idempotencyKey: randomIdempotencyKey("stay"),
				}),
			);
		},
		[cart, mutateItem],
	);

	const handleSaveGuests = useCallback(
		(itemId: string, next: GuestSelection) => {
			if (!cart) {
				return;
			}
			void mutateItem(itemId, () =>
				api.updateCartItem(cart.id, itemId, {
					adults: next.adults,
					children: next.children,
					guests: capacityForGuests(next.adults, next.children),
					idempotencyKey: randomIdempotencyKey("stay"),
					infants: next.infants,
				}),
			);
		},
		[cart, mutateItem],
	);

	const handleRemove = useCallback(
		(itemId: string) => {
			if (!cart) {
				return;
			}
			void mutateItem(itemId, () =>
				api.removeCartItem(cart.id, itemId, randomIdempotencyKey("remove")),
			);
		},
		[cart, mutateItem],
	);

	if (phase === "loading") {
		return <CartLoading />;
	}

	const items = activeItems(cart);
	if (!cart || items.length === 0) {
		return <EmptyCart />;
	}

	const dialogItem = dialog
		? (items.find((item) => item.id === dialog.itemId) ?? null)
		: null;
	const dialogConstraints = dialogItem
		? (constraints.get(dialogItem.listingId) ?? DEFAULT_CONSTRAINTS)
		: DEFAULT_CONSTRAINTS;
	const hasFailures = failures.size > 0;

	return (
		<div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
			<div className="flex flex-col gap-4">
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
						onChangeDates={() => setDialog({ itemId: item.id, kind: "dates" })}
						onChangeGuests={() =>
							setDialog({ itemId: item.id, kind: "guests" })
						}
						onRemove={() => handleRemove(item.id)}
						pending={pendingItemId !== null}
					/>
				))}
			</div>

			<aside className="lg:sticky lg:top-24 lg:self-start">
				<div className="rounded-2xl border bg-card p-5 shadow-sm">
					<h2 className="font-heading font-semibold text-lg">Summary</h2>
					<Separator className="my-4" />
					<div className="flex flex-col gap-2 text-sm">
						<div className="flex items-center justify-between text-muted-foreground">
							<span>
								{items.length} {items.length === 1 ? "stay" : "stays"}
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

					{hasFailures && (
						<p className="mt-3 text-amber-700 text-sm dark:text-amber-300">
							Fix or remove the flagged stays to continue to checkout.
						</p>
					)}

					<Button
						asChild={!hasFailures}
						className="mt-4 w-full rounded-full"
						disabled={hasFailures}
						size="lg"
					>
						{hasFailures ? (
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

			{dialogItem && dialog?.kind === "dates" && (
				<ChangeDatesDialog
					listingId={dialogItem.listingId}
					minNights={dialogConstraints.minNights}
					onOpenChange={(open) => {
						if (!open) {
							setDialog(null);
						}
					}}
					onSave={(next) => handleSaveDates(dialogItem.id, next)}
					open
					saving={pendingItemId !== null}
					value={{ checkIn: dialogItem.checkIn, checkOut: dialogItem.checkOut }}
				/>
			)}
			{dialogItem && dialog?.kind === "guests" && (
				<ChangeGuestsDialog
					maxGuests={dialogConstraints.maxGuests}
					onOpenChange={(open) => {
						if (!open) {
							setDialog(null);
						}
					}}
					onSave={(next) => handleSaveGuests(dialogItem.id, next)}
					open
					saving={pendingItemId !== null}
					value={{
						adults: dialogItem.adults,
						children: dialogItem.children,
						infants: dialogItem.infants,
					}}
				/>
			)}
		</div>
	);
}
