import type { AmenityCatalogEntry } from "./amenity-catalog";

export interface PublicAmenityGroup extends AmenityCatalogEntry {
	key: string;
	sourceIds: readonly string[];
	sourceLabels?: readonly string[];
}

export const PUBLIC_AMENITY_GROUPS = {
	"air-conditioning": {
		icon: "FaSnowflake",
		key: "air-conditioning",
		label: "Air conditioning",
		sourceIds: ["46", "671"],
		sourceLabels: ["Air conditioning", "Air condition window"],
	},
	"dvd-player": {
		icon: "FaTv",
		key: "dvd-player",
		label: "DVD player",
		sourceIds: ["122", "228"],
		sourceLabels: ["DVD", "DVD player"],
	},
	dryer: {
		icon: "FaShirt",
		key: "dryer",
		label: "Dryer",
		sourceIds: ["45", "723"],
		sourceLabels: ["Dryer", "Dryer on property"],
	},
	kitchen: {
		icon: "FaKitchenSet",
		key: "kitchen",
		label: "Kitchen",
		sourceIds: ["3", "114"],
		sourceLabels: ["Kitchen", "Full kitchen"],
	},
	"ping-pong-table": {
		icon: "FaTableTennisPaddleBall",
		key: "ping-pong-table",
		label: "Ping-pong table",
		sourceIds: ["260", "638"],
		sourceLabels: ["Ping-pong table", "Ping pong table"],
	},
	refrigerator: {
		icon: "FaKitchenSet",
		key: "refrigerator",
		label: "Refrigerator",
		sourceIds: ["25", "160", "188"],
		sourceLabels: ["Refrigerator", "Fridge / freezer", "Fridge"],
	},
	"step-free-access": {
		icon: "FaWheelchair",
		key: "step-free-access",
		label: "Step-free access",
		sourceIds: ["34", "751"],
		sourceLabels: ["Step-free access", "Step free access"],
	},
	terrace: {
		icon: "FaTreeCity",
		key: "terrace",
		label: "Terrace",
		sourceIds: ["130", "765"],
		sourceLabels: ["Terrace"],
	},
	washer: {
		icon: "FaShirt",
		key: "washer",
		label: "Washer",
		sourceIds: ["5", "161", "719"],
		sourceLabels: ["Washer", "Washing machine", "Washer on property"],
	},
	"wide-doorway": {
		icon: "FaDoorClosed",
		key: "wide-doorway",
		label: "Wide doorway",
		sourceIds: ["32", "67"],
		sourceLabels: ["Wide doorway"],
	},
	wifi: {
		icon: "FaWifi",
		key: "wifi",
		label: "Wifi",
		sourceIds: [
			"2",
			"97",
			"128",
			"171",
			"230",
			"232",
			"487",
			"488",
			"489",
			"490",
			"491",
			"492",
		],
		sourceLabels: [
			"Wireless Internet",
			"Internet connection",
			"FREE internet access",
			"Free Wireless Internet",
			"High speed Internet access",
			"Free cable internet",
			"Paid wireless internet",
			"Wifi speed (25 Mbps)",
			"Wifi speed (50 Mbps)",
			"Wifi speed (100 Mbps)",
			"Wifi speed (250 Mbps)",
			"Wifi speed (500 Mbps)",
		],
	},
} as const satisfies Record<string, PublicAmenityGroup>;

export const PUBLIC_AMENITY_GROUP_CATALOG: Readonly<
	Record<string, AmenityCatalogEntry>
> = Object.fromEntries(
	Object.values(PUBLIC_AMENITY_GROUPS).map((group) => [
		group.key,
		{ icon: group.icon, label: group.label },
	]),
);

const GROUP_BY_SOURCE_ID = new Map<string, PublicAmenityGroup>();
const GROUP_BY_SOURCE_LABEL = new Map<string, PublicAmenityGroup>();

for (const group of Object.values(PUBLIC_AMENITY_GROUPS)) {
	for (const id of group.sourceIds) {
		GROUP_BY_SOURCE_ID.set(id, group);
	}

	for (const label of group.sourceLabels ?? []) {
		GROUP_BY_SOURCE_LABEL.set(normalizeAmenityLabel(label), group);
	}
}

export function publicAmenityGroupForInput(input: {
	id: string | null;
	sourceLabel: string;
}): PublicAmenityGroup | null {
	if (input.id) {
		const byId = GROUP_BY_SOURCE_ID.get(input.id);
		if (byId) {
			return byId;
		}
	}

	return (
		GROUP_BY_SOURCE_LABEL.get(normalizeAmenityLabel(input.sourceLabel)) ?? null
	);
}

function normalizeAmenityLabel(value: string): string {
	return value
		.replace(/&amp;/gi, "and")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}
