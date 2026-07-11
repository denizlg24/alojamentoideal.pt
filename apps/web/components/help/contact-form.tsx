"use client";

import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";

const FIELD_CLASS =
	"mt-2 w-full border-0 border-[#d8cbbd] border-b bg-transparent px-0 py-3 text-[#2e2925] outline-none transition placeholder:text-[#9d9389] focus:border-[#9b5c3d] focus:ring-0";

const MESSAGE_MAX = 2048;

export function ContactForm() {
	const [pending, setPending] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [messageLength, setMessageLength] = useState(0);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(event.currentTarget);
		const payload = {
			email: String(form.get("email") ?? ""),
			message: String(form.get("message") ?? ""),
			name: String(form.get("name") ?? ""),
			subject: String(form.get("subject") ?? ""),
		};

		try {
			const response = await fetch("/api/contact", {
				body: JSON.stringify(payload),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					body?.error ?? "We could not send your message. Please try again.",
				);
			}
			setSubmitted(true);
			event.currentTarget.reset();
		} catch (submissionError) {
			setError(
				submissionError instanceof Error
					? submissionError.message
					: "We could not send your message. Please try again.",
			);
		} finally {
			setPending(false);
		}
	}

	if (submitted) {
		return (
			<div className="flex flex-col justify-center border-[#d8cbbd] border-t py-12">
				<div className="grid size-12 place-items-center rounded-full bg-[#3f4d45] text-[#f8f5ef]">
					<Check className="size-6" />
				</div>
				<p className="mt-7 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.2em]">
					Message sent
				</p>
				<h3 className="mt-3 max-w-md font-display text-4xl leading-none tracking-[-0.05em]">
					We will get back to you shortly.
				</h3>
				<p className="mt-5 max-w-md text-[#665d55] leading-relaxed">
					Thanks for reaching out. A confirmation copy is on its way to your
					inbox, and someone from our team will reply as soon as possible.
				</p>
			</div>
		);
	}

	return (
		<form className="border-[#d8cbbd] border-t pt-7" onSubmit={submit}>
			<div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em]">
					Name
					<input
						className={FIELD_CLASS}
						maxLength={120}
						name="name"
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
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em] sm:col-span-2">
					Subject
					<input
						className={FIELD_CLASS}
						maxLength={200}
						name="subject"
						placeholder="What is this about?"
						required
						type="text"
					/>
				</label>
				<label className="block text-[#665d55] text-xs uppercase tracking-[0.14em] sm:col-span-2">
					Message
					<textarea
						className={`${FIELD_CLASS} min-h-32 resize-y`}
						maxLength={MESSAGE_MAX}
						minLength={16}
						name="message"
						onChange={(event) => setMessageLength(event.target.value.length)}
						placeholder="Tell us how we can help. Include your booking reference if you have one."
						required
					/>
					<span className="mt-1 block text-right text-[#9d9389] text-[11px] normal-case tracking-normal">
						{messageLength}/{MESSAGE_MAX}
					</span>
				</label>
			</div>

			<div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="max-w-xs text-[#81766c] text-xs leading-relaxed">
					We reply to the email address you provide, usually within one business
					day.
				</p>
				<button
					className="group inline-flex items-center gap-3 rounded-full bg-[#9b5c3d] px-6 py-3.5 font-medium text-sm text-white transition hover:bg-[#7f472f] disabled:cursor-wait disabled:opacity-70"
					disabled={pending}
					type="submit"
				>
					{pending ? "Sending message" : "Send message"}
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
