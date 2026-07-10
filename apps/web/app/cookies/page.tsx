import { permanentRedirect } from "next/navigation";

export default function CookiesRedirect() {
	permanentRedirect("/legal/cookies");
}
