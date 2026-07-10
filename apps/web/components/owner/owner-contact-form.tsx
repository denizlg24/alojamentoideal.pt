"use client";

import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";

const FIELD_CLASS =
	"mt-2 w-full border-0 border-[#d8cbbd] border-b bg-transparent px-0 py-3 text-[#2e2925] outline-none transition placeholder:text-[#9d9389] focus:border-[#9b5c3d] focus:ring-0";

export function OwnerContactForm() {
	const [pending, setPending] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(event.currentTarget);
		const payload = {
			bedroomCount: Number(form.get("bedroomCount")),
			email: String(form.get("email") ?? ""),
			fullName: String(form.get("fullName") ?? ""),
			phoneNumber: String(form.get("phoneNumber") ?? ""),
			propertyAddress: String(form.get("propertyAddress") ?? ""),
			propertyCount: Number(form.get("propertyCount")),
			propertyLocation: String(form.get("propertyLocation") ?? ""),
		};

		try {
			const response = await fetch("/api/owner-contacts", {
				body: JSON.stringify(payload),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					body?.error ?? "We could not send your details. Please try again.",
				);
			}
			setSubmitted(true);
			event.currentTarget.reset();
		} catch (submissionError) {
			setError(
				submissionError instanceof Error
					? submissionError.message
					: "We could not send your details. Please try again.",
			);
		} finally {
			setPending(false);
		}
	}

	if (submitted) {
		return (
			<div className="flex min-h-[28rem] flex-col justify-center border-[#d8cbbd] border-t py-10">
				<div className="grid size-12 place-items-center rounded-full bg-[#3f4d45] text-[#f8f5ef]">
					<Check className="size-6" />
				</div>
				<p className="mt-7 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.2em]">
					Thank you
				</p>
				<h2 className="mt-3 max-w-md font-display text-4xl leading-none tracking-[-0.05em] sm:text-5xl">
					Your property is worth a conversation.
				</h2>
				<p className="mt-5 max-w-md text-[#665d55] leading-relaxed">
					We have received your details. Our team will be in touch shortly to
					discuss your property and the next steps.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={submit} className="border-[#d8cbbd] border-t pt-7">
			<div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
					Full name
					<input
						className={FIELD_CLASS}
						maxLength={120}
						name="fullName"
						placeholder="Your name"
						required
						type="text"
					/>
				</label>
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
					Email address
					<input
						className={FIELD_CLASS}
						maxLength={254}
						name="email"
						placeholder="you@example.com"
						required
						type="email"
					/>
				</label>
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
					Phone number
					<input
						className={FIELD_CLASS}
						maxLength={32}
						name="phoneNumber"
						placeholder="+351 912 345 678"
						required
						type="tel"
					/>
				</label>
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
					Property location
					<input
						className={FIELD_CLASS}
						maxLength={120}
						name="propertyLocation"
						placeholder="Porto, Canidelo, ..."
						required
						type="text"
					/>
				</label>
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em] sm:col-span-2">
					Property address
					<input
						className={FIELD_CLASS}
						maxLength={240}
						name="propertyAddress"
						placeholder="Street, number and postcode"
						required
						type="text"
					/>
				</label>
				<div className="grid grid-cols-2 gap-8 sm:col-span-2">
					<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
						Properties
						<input
							className={FIELD_CLASS}
							defaultValue="1"
							max="999"
							min="1"
							name="propertyCount"
							required
							type="number"
						/>
					</label>
					<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
						Bedrooms in total
						<input
							className={FIELD_CLASS}
							defaultValue="1"
							max="999"
							min="0"
							name="bedroomCount"
							required
							type="number"
						/>
					</label>
				</div>
			</div>

			<div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="max-w-xs text-[#81766c] text-xs leading-relaxed">
					Tell us a little about the property. We will take it from here.
				</p>
				<button
					className="group inline-flex items-center gap-3 rounded-full bg-[#9b5c3d] px-6 py-3.5 font-medium text-sm text-white transition hover:bg-[#7f472f] disabled:cursor-wait disabled:opacity-70"
					disabled={pending}
					type="submit"
				>
					{pending ? "Sending details" : "Start the conversation"}
					{pending ? (
						<LoaderCircle className="size-4 animate-spin" />
					) : (
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
					)}
				</button>
			</div>
			{error ? (
				<p aria-live="polite" className="mt-4 text-red-700 text-sm">
					{error}
				</p>
			) : null}
		</form>
	);
}
