import { permanentRedirect } from "next/navigation";

export default function TermsRedirect() {
	permanentRedirect("/legal/terms");
}
