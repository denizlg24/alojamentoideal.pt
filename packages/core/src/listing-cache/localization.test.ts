import { afterEach, describe, expect, test } from "bun:test";
import { requestListingLocalization } from "./localization";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("requestListingLocalization", () => {
	test("removes localized section output when the source section is a placeholder", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					output_text: JSON.stringify({
						description: {
							en: "A bright stay in Porto.",
							es: "Una estancia luminosa en Oporto.",
							pt: "Uma estadia luminosa no Porto.",
						},
						descriptionSections: {
							access: { en: "", es: "", pt: "" },
							interaction: { en: "", es: "", pt: "" },
							neighborhood_overview: { en: "", es: "", pt: "" },
							notes: {
								en: "",
								es: "Texto antiguo que ya no existe en la fuente.",
								pt: "",
							},
							space: {
								en: "Cozy apartment with garden access.",
								es: "Apartamento acogedor con acceso al jardín.",
								pt: "Apartamento acolhedor com acesso ao jardim.",
							},
							transit: { en: "", es: "", pt: "" },
						},
						guide: { en: "", es: "", pt: "" },
					}),
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		const result = await requestListingLocalization(
			{ apiKey: "test-key", maxAttempts: 1, model: "test-model" },
			{
				description: "A bright stay in Porto.",
				descriptionSections: {
					notes: ".",
					space: "Cozy apartment with garden access.",
				},
				facts: {
					amenities: [],
					bathrooms: null,
					bedrooms: null,
					beds: null,
					capacity: null,
					city: "Porto",
					country: "Portugal",
					propertyType: "Apartment",
					title: "Casa Jardim A",
				},
				guide: "",
				translations: [],
			},
		);

		expect(result.descriptionSections.notes).toEqual({
			en: "",
			es: "",
			pt: "",
		});
		expect(result.descriptionSections.space.en).toBe(
			"Cozy apartment with garden access.",
		);
	});
});
