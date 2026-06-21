"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Check, Copy, Mail, Share, Share2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

interface ShareDialogProps {
	imageUrl: string | null;
	subtitle: string | null;
	title: string;
}

export function ShareButton({ imageUrl, subtitle, title }: ShareDialogProps) {
	const [url, setUrl] = useState("");
	const [copied, setCopied] = useState(false);
	const [canNativeShare, setCanNativeShare] = useState(false);

	useEffect(() => {
		setUrl(window.location.href);
		setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
	}, []);

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(url || window.location.href);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard can be blocked (insecure context / permissions); the visible
			// URL field still lets the visitor copy manually.
		}
	};

	const nativeShare = async () => {
		try {
			await navigator.share({ title, url: url || window.location.href });
		} catch {
			// User dismissed the share sheet, or it is unavailable; ignore.
		}
	};

	const encodedUrl = encodeURIComponent(url);
	const encodedTitle = encodeURIComponent(title);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="ml-auto flex items-center gap-1.5 font-medium text-foreground text-sm underline"
				>
					<Share className="size-4" />
					Share
				</button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share this home</DialogTitle>
				</DialogHeader>

				<div className="flex items-center gap-3 rounded-xl border p-3">
					{imageUrl && (
						<div className="relative size-14 shrink-0 overflow-hidden rounded-lg">
							<Image
								src={imageUrl}
								alt=""
								fill
								sizes="56px"
								className="object-cover"
							/>
						</div>
					)}
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-medium text-sm">{title}</span>
						{subtitle && (
							<span className="truncate text-muted-foreground text-xs">
								{subtitle}
							</span>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2">
					<Input
						readOnly
						value={url}
						aria-label="Listing link"
						onFocus={(event) => event.currentTarget.select()}
						className="flex-1"
					/>
					<Button type="button" onClick={copyLink} className="shrink-0">
						{copied ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>

				<div className="grid grid-cols-4 gap-2">
					<ShareChannel
						href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`}
						icon={<WhatsAppIcon />}
						label="WhatsApp"
					/>
					<ShareChannel
						href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
						icon={<FacebookIcon />}
						label="Facebook"
					/>
					<ShareChannel
						href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`}
						icon={<XIcon />}
						label="X"
					/>
					<ShareChannel
						href={`mailto:?subject=${encodedTitle}&body=${encodedUrl}`}
						icon={<Mail className="size-5" />}
						label="Email"
					/>
				</div>

				{canNativeShare && (
					<Button
						type="button"
						variant="outline"
						className="w-full"
						onClick={nativeShare}
					>
						<Share2 className="size-4" />
						More options
					</Button>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ShareChannel({
	href,
	icon,
	label,
}: {
	href: string;
	icon: ReactNode;
	label: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-colors hover:bg-accent"
		>
			<span className="flex size-7 items-center justify-center">{icon}</span>
			{label}
		</a>
	);
}

// lucide-react dropped brand glyphs, so the social marks are inline single-path
// SVGs (Simple Icons), tinted with each brand's color.
function WhatsAppIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-5 text-[#25D366]"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
		</svg>
	);
}

function FacebookIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-5 text-[#1877F2]"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
		</svg>
	);
}

function XIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-5 text-foreground"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
		</svg>
	);
}
