import { getRuntimeSettings } from "../core/src/settings/index";

const settings = await getRuntimeSettings();
console.log(
	JSON.stringify(
		{
			envDetours: process.env.STRIPE_DETOURS_ACCOUNT_ID ?? null,
			settingDetours: settings["payments.detoursStripeAccountId"] ?? null,
		},
		null,
		2,
	),
);
process.exit(0);
