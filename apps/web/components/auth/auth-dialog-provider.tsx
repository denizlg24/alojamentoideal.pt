"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@workspace/ui/components/drawer";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSession } from "@/lib/auth/client";
import { AuthReturnLink } from "./auth-return-link";
import { ForgotPasswordForm } from "./forgot-password-form";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

export type AuthView = "login" | "register" | "forgot";

interface OpenAuthOptions {
	/** Which form to show first. Defaults to "login". */
	view?: AuthView;
	/** Same-origin path the email-verification / page flows return to. */
	next?: string;
}

interface AuthDialogContextValue {
	openAuth: (options?: OpenAuthOptions) => void;
	close: () => void;
}

const AuthDialogContext = createContext<AuthDialogContextValue | null>(null);

/** Imperative handle to the global auth overlay. */
export function useAuthDialog(): AuthDialogContextValue {
	const value = useContext(AuthDialogContext);
	if (!value) {
		throw new Error("useAuthDialog must be used within <AuthDialogProvider>");
	}
	return value;
}

const VIEW_TITLES: Record<AuthView, { subtitle: string; title: string }> = {
	forgot: {
		subtitle: "Enter your email and we'll send you a reset link.",
		title: "Reset your password",
	},
	login: {
		subtitle: "Log in to manage your stays.",
		title: "Welcome back",
	},
	register: {
		subtitle: "It only takes a minute.",
		title: "Create your account",
	},
};

/**
 * Hosts the login/register/forgot forms in a modal that can overlay any page.
 * Lives once at the root layout. Desktop renders a centered Dialog; mobile
 * renders a near-full-height Drawer for a full-page feel. The standalone
 * `/login` etc. pages remain the canonical URLs for email links and direct
 * navigation; this overlay reuses the same form components.
 */
export function AuthDialogProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const isMobile = useIsMobile();
	const { data: session } = useSession();

	const [open, setOpen] = useState(false);
	const [view, setView] = useState<AuthView>("login");
	const [next, setNext] = useState("/");

	// Latest signed-in flag without re-creating `openAuth` on every session tick.
	const signedInRef = useRef(false);
	signedInRef.current = Boolean(session?.user);

	const close = useCallback(() => setOpen(false), []);

	const openAuth = useCallback((options?: OpenAuthOptions) => {
		// Already authenticated: there is nothing to do, so never surface the form.
		if (signedInRef.current) {
			return;
		}
		setView(options?.view ?? "login");
		setNext(options?.next ?? "/");
		setOpen(true);
	}, []);

	const handleSuccess = useCallback(() => {
		setOpen(false);
		// Let Server Components and session-aware client effects pick up the new
		// session without a hard navigation away from the current page.
		router.refresh();
	}, [router]);

	const contextValue = useMemo<AuthDialogContextValue>(
		() => ({ close, openAuth }),
		[close, openAuth],
	);

	const meta = VIEW_TITLES[view];

	const body = (
		<div className="flex flex-col gap-5">
			<AuthReturnLink next={next} />
			{view === "login" && (
				<LoginForm
					next={next}
					onSuccess={handleSuccess}
					onSwitchView={setView}
				/>
			)}
			{view === "register" && (
				<RegisterForm next={next} onSwitchView={setView} />
			)}
			{view === "forgot" && <ForgotPasswordForm onSwitchView={setView} />}

			{view !== "forgot" && (
				<div className="text-center text-muted-foreground text-sm">
					{view === "login" ? (
						<>
							New to Alojamento Ideal?{" "}
							<button
								className="underline"
								onClick={() => setView("register")}
								type="button"
							>
								Create an account
							</button>
						</>
					) : (
						<>
							Already have an account?{" "}
							<button
								className="underline"
								onClick={() => setView("login")}
								type="button"
							>
								Log in
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);

	return (
		<AuthDialogContext.Provider value={contextValue}>
			{children}
			{isMobile ? (
				<Drawer onOpenChange={(value) => !value && close()} open={open}>
					<DrawerContent className="max-h-[92vh]">
						<DrawerHeader className="text-center">
							<DrawerTitle className="font-heading text-2xl">
								{meta.title}
							</DrawerTitle>
							<DrawerDescription>{meta.subtitle}</DrawerDescription>
						</DrawerHeader>
						<div className="overflow-y-auto px-4 pb-8">{body}</div>
					</DrawerContent>
				</Drawer>
			) : (
				<Dialog onOpenChange={(value) => !value && close()} open={open}>
					<DialogContent className="max-w-md">
						<DialogHeader className="text-center sm:text-center">
							<DialogTitle className="font-heading text-2xl">
								{meta.title}
							</DialogTitle>
							<DialogDescription>{meta.subtitle}</DialogDescription>
						</DialogHeader>
						{body}
					</DialogContent>
				</Dialog>
			)}
		</AuthDialogContext.Provider>
	);
}
