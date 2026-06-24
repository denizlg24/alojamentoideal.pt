/**
 * Contextual hint shown when the visitor arrived from checkout, reassuring them
 * they will return to their booking after authenticating.
 */
export function AuthReturnLink({ next }: { next: string }) {
	if (!next.startsWith("/homes/")) {
		return null;
	}
	return (
		<p className="mb-4 rounded-xl bg-muted px-3 py-2 text-center text-muted-foreground text-sm">
			You'll return to your booking right after you sign in.
		</p>
	);
}
