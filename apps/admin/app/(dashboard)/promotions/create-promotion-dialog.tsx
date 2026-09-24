"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Plus } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useRef,
	useState,
	useTransition,
} from "react";
import { CreatePromotionForm } from "./create-promotion-form";

type OpenCreateDialog = (opener: HTMLElement) => void;

const OpenCreateDialogContext = createContext<OpenCreateDialog | null>(null);

/**
 * Hosts the single "New code" dialog so the header button and the empty state
 * share one form, and keeps the dialog open while a code is being created.
 */
export function CreatePromotionProvider({
	children,
	currency,
}: {
	children: ReactNode;
	currency: string;
}) {
	const [open, setOpen] = useState(false);
	const [pending, startTransition] = useTransition();
	const openerRef = useRef<HTMLElement | null>(null);

	function openDialog(opener: HTMLElement) {
		openerRef.current = opener;
		setOpen(true);
	}

	return (
		<OpenCreateDialogContext value={openDialog}>
			{children}
			<Dialog
				onOpenChange={(next) => {
					if (!pending) {
						setOpen(next);
					}
				}}
				open={open}
			>
				<DialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
					onCloseAutoFocus={(event) => {
						// The opener may be the empty state, which unmounts once a code exists.
						event.preventDefault();
						const opener = openerRef.current?.isConnected
							? openerRef.current
							: document.querySelector<HTMLElement>(
									"[data-new-promotion-code]",
								);
						opener?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>New promotion code</DialogTitle>
						<DialogDescription>
							Guests enter it at checkout. It is created in Stripe right away.
						</DialogDescription>
					</DialogHeader>
					<CreatePromotionForm
						currency={currency}
						onCreated={() => setOpen(false)}
						pending={pending}
						startTransition={startTransition}
					/>
				</DialogContent>
			</Dialog>
		</OpenCreateDialogContext>
	);
}

export function NewPromotionButton({
	variant = "default",
}: {
	variant?: "default" | "outline";
}) {
	const openDialog = useContext(OpenCreateDialogContext);
	if (!openDialog) {
		throw new Error(
			"NewPromotionButton must be inside CreatePromotionProvider.",
		);
	}

	return (
		<Button
			data-new-promotion-code
			onClick={(event) => openDialog(event.currentTarget)}
			type="button"
			variant={variant}
		>
			<Plus aria-hidden data-icon="inline-start" />
			New code
		</Button>
	);
}
