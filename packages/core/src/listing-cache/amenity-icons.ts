export const AMENITY_ICON_SET = "fa6" as const;

/**
 * Allowed Font Awesome 6 icon names for amenities. Every name must exist in
 * `react-icons/fa6` because the web renderer maps these strings to components.
 * The static amenity catalog (`amenity-catalog.ts`) and the keyword fallback
 * (`pickAmenityIcon`) may only emit names from this set.
 */
export const AMENITY_ICON_NAMES = [
	"FaBath",
	"FaBed",
	"FaBellConcierge",
	"FaBicycle",
	"FaBinoculars",
	"FaBlender",
	"FaBookOpen",
	"FaBookmark",
	"FaBowlFood",
	"FaBriefcase",
	"FaBaby",
	"FaBabyCarriage",
	"FaBan",
	"FaCamera",
	"FaCar",
	"FaChargingStation",
	"FaChess",
	"FaChild",
	"FaClock",
	"FaCouch",
	"FaDesktop",
	"FaDice",
	"FaDog",
	"FaDoorClosed",
	"FaDroplet",
	"FaDumbbell",
	"FaElevator",
	"FaEthernet",
	"FaFan",
	"FaFire",
	"FaFireBurner",
	"FaFireExtinguisher",
	"FaFireFlameCurved",
	"FaGamepad",
	"FaGuitar",
	"FaHeadphones",
	"FaHotTubPerson",
	"FaHouse",
	"FaHouseSignal",
	"FaJar",
	"FaKey",
	"FaKitchenSet",
	"FaLightbulb",
	"FaLock",
	"FaMountain",
	"FaMountainSun",
	"FaMugHot",
	"FaMugSaucer",
	"FaMusic",
	"FaPaw",
	"FaPersonHiking",
	"FaPersonSkiing",
	"FaPersonSwimming",
	"FaPlateWheat",
	"FaPlug",
	"FaPumpSoap",
	"FaSailboat",
	"FaSatelliteDish",
	"FaSeedling",
	"FaShield",
	"FaShieldHeart",
	"FaShirt",
	"FaShower",
	"FaSink",
	"FaSmoking",
	"FaSnowflake",
	"FaSoap",
	"FaSocks",
	"FaSpa",
	"FaSquareParking",
	"FaStairs",
	"FaSuitcaseMedical",
	"FaTableTennisPaddleBall",
	"FaTemperatureArrowUp",
	"FaTemperatureHalf",
	"FaToilet",
	"FaToiletPaper",
	"FaTree",
	"FaTreeCity",
	"FaTv",
	"FaUmbrellaBeach",
	"FaUtensils",
	"FaVault",
	"FaVideo",
	"FaWarehouse",
	"FaWater",
	"FaWaterLadder",
	"FaWheelchair",
	"FaWifi",
	"FaWind",
	"FaWineBottle",
	"FaWineGlass",
] as const;

export type AmenityIconName = (typeof AMENITY_ICON_NAMES)[number];

const DEFAULT_ICON: AmenityIconName = "FaBellConcierge";

/**
 * Per-Hostify-id icon overrides applied during catalog generation, for the
 * cases where the keyword heuristic picks a poor or wrong icon. Add entries
 * here and re-run `scripts/generate-amenity-catalog.ts`; the generated catalog
 * bakes these in so runtime never reads this map.
 */
export const AMENITY_ICON_OVERRIDES: Readonly<Record<string, AmenityIconName>> =
	{};

/**
 * Ordered keyword to icon rules, most specific first. Used to generate the
 * static catalog and as the runtime fallback for amenity ids absent from it.
 */
const KEYWORD_ICONS: ReadonlyArray<[RegExp, AmenityIconName]> = [
	// Connectivity
	[/ethernet|wired internet/i, "FaEthernet"],
	[/wi-?fi|wireless|internet|broadband/i, "FaWifi"],
	[/pocket wifi|mobile hotspot|signal/i, "FaHouseSignal"],
	// Entertainment
	[/cable|satellite|streaming|netflix|chromecast|roku/i, "FaSatelliteDish"],
	[/\btv\b|television|hdtv/i, "FaTv"],
	[/sound system|speaker|stereo|record player|headphone/i, "FaHeadphones"],
	[/piano|guitar|instrument/i, "FaGuitar"],
	[/music|vinyl/i, "FaMusic"],
	[/console|playstation|xbox|nintendo|arcade|video game/i, "FaGamepad"],
	[
		/board game|chess|ping pong|table tennis|foosball|pool table|billiard/i,
		"FaChess",
	],
	[/\bgame|toys/i, "FaDice"],
	[/book|library|reading|magazine/i, "FaBookOpen"],
	// Climate
	[/air condition|\ba\/?c\b|cooling|split|ductless/i, "FaSnowflake"],
	[/ceiling fan|portable fan|\bfan\b/i, "FaFan"],
	[/indoor fireplace|wood.?burning|fireplace/i, "FaFireFlameCurved"],
	[/radiant|central heat|heat|heating|radiator/i, "FaTemperatureArrowUp"],
	[/thermostat|temperature/i, "FaTemperatureHalf"],
	[/ventilation|air purifier|\bwind\b/i, "FaWind"],
	// Kitchen
	[/coffee|espresso|nespresso|keurig|tea\b/i, "FaMugSaucer"],
	[/kettle|hot water dispenser/i, "FaMugHot"],
	[/blender|juicer|food processor/i, "FaBlender"],
	[/wine|bar fridge|wine cooler/i, "FaWineGlass"],
	[/champagne|liquor|spirits/i, "FaWineBottle"],
	[/dishes|silverware|cutlery|glassware|plates|bowls/i, "FaPlateWheat"],
	[/cookware|pots and pans|baking|bbq utensils/i, "FaBowlFood"],
	[
		/oven|stove|cooktop|burner|hob|microwave|toaster|grill|barbecue|\bbbq\b/i,
		"FaFireBurner",
	],
	[/dishwasher|sink|garbage disposal/i, "FaSink"],
	[
		/kitchenette|kitchen island|kitchen|fridge|refrigerator|freezer|dining|breakfast bar/i,
		"FaKitchenSet",
	],
	[/breakfast|restaurant|meals|food/i, "FaUtensils"],
	[/pantry|condiments|jar|spices/i, "FaJar"],
	// Bathroom
	[/shampoo|conditioner|body soap|body wash|shower gel/i, "FaPumpSoap"],
	[/soap|cleaning product|detergent/i, "FaSoap"],
	[/hot water/i, "FaDroplet"],
	[/bathtub|\bbath\b|jacuzzi tub/i, "FaBath"],
	[/bidet/i, "FaToilet"],
	[/toilet paper|paper towel|tissue/i, "FaToiletPaper"],
	[/shower|rain shower/i, "FaShower"],
	[/toilet|\bwc\b|restroom/i, "FaToilet"],
	// Laundry / clothing
	[/washer|washing machine|laundromat|laundry/i, "FaShirt"],
	[/dryer|drying rack|clothesline/i, "FaShirt"],
	[/iron|hangers|wardrobe|closet|clothing storage|dresser/i, "FaShirt"],
	[/socks|slippers/i, "FaSocks"],
	// Bedroom / living
	[/bed linen|pillow|blanket|sheets|mattress|\bbed\b|crib|cot/i, "FaBed"],
	[/sofa|couch|living|lounge|seating/i, "FaCouch"],
	// Family
	[/baby bath|baby monitor|baby gate|babysitter|baby/i, "FaBaby"],
	[/stroller|high ?chair|pack ?n ?play|changing table/i, "FaBabyCarriage"],
	[/children|kid|family|playground/i, "FaChild"],
	// Safety / security
	[/first aid|medical|defibrillator|\baed\b/i, "FaSuitcaseMedical"],
	[
		/fire extinguisher|smoke alarm|smoke detector|carbon monoxide|co detector/i,
		"FaFireExtinguisher",
	],
	[/security camera|surveillance|cctv/i, "FaCamera"],
	[/doorbell camera|video monitor/i, "FaVideo"],
	[/safe\b|vault|lockbox|security deposit box/i, "FaVault"],
	[/lock on|smart lock|keypad|deadbolt|lock/i, "FaLock"],
	[/self check|keyless|key\b/i, "FaKey"],
	[/security|safety|guard|gated/i, "FaShieldHeart"],
	[/shield|protection|insurance/i, "FaShield"],
	// Parking / transport
	[/ev charger|electric vehicle|charging/i, "FaChargingStation"],
	[/garage|carport/i, "FaWarehouse"],
	[/parking|driveway/i, "FaSquareParking"],
	[/\bcar\b|vehicle|shuttle|transfer/i, "FaCar"],
	[/bike|bicycle|cycling/i, "FaBicycle"],
	[/ski|snowboard/i, "FaPersonSkiing"],
	[/boat|kayak|canoe|paddle ?board|sailing/i, "FaSailboat"],
	// Outdoor / nature / water
	[/hot tub|spa tub/i, "FaHotTubPerson"],
	[/sauna|steam room|massage|wellness|spa/i, "FaSpa"],
	[/pool|swim/i, "FaWaterLadder"],
	[/beach|seaside|oceanfront|beachfront/i, "FaUmbrellaBeach"],
	[/lake|river|waterfront|sea view|ocean|water/i, "FaWater"],
	[/mountain view|mountain|valley/i, "FaMountainSun"],
	[/hiking|trail|trekking/i, "FaPersonHiking"],
	[/binoculars|telescope|scenic|view/i, "FaBinoculars"],
	[/garden|backyard|plants|greenery|tree/i, "FaTree"],
	[/patio|balcony|terrace|porch|deck|courtyard/i, "FaTreeCity"],
	[/lawn|yard|outdoor furniture|hammock|seedling/i, "FaSeedling"],
	// Fitness
	[/gym|fitness|exercise|weights|treadmill|dumbbell/i, "FaDumbbell"],
	[/tennis|badminton|racket/i, "FaTableTennisPaddleBall"],
	// Accessibility / building
	[/wheelchair|accessible|step.?free|grab rail|disabled/i, "FaWheelchair"],
	[/elevator|lift/i, "FaElevator"],
	[/stairs|staircase|single level|step/i, "FaStairs"],
	[/private entrance|entrance|door/i, "FaDoorClosed"],
	[/apartment|building|residential|house|home/i, "FaHouse"],
	// Workspace
	[/workspace|desk|laptop|monitor|office|coworking/i, "FaBriefcase"],
	[/computer|printer|scanner/i, "FaDesktop"],
	// Services / misc
	[/long.?term|monthly|weekly stay|extended/i, "FaClock"],
	[
		/concierge|reception|host|service|cleaning service|housekeeping/i,
		"FaBellConcierge",
	],
	[/pet|dog|cat|animal/i, "FaDog"],
	[/paw|pet bowl|litter/i, "FaPaw"],
	[/lamp|lighting|light|essentials|electric/i, "FaLightbulb"],
	[/outlet|socket|plug|adapter|power/i, "FaPlug"],
	[/smoking allowed|cigarette/i, "FaSmoking"],
	[/no smoking|not allowed|prohibited/i, "FaBan"],
	[/fire pit|bonfire|campfire/i, "FaFire"],
	// Services, recreation and descriptors that the category rules above miss.
	[/cooking basics|bread maker|rice maker|cooking service/i, "FaFireBurner"],
	[/ice maker/i, "FaSnowflake"],
	[/minibar|\bbar\b|bartender/i, "FaWineGlass"],
	[
		/chef|waitstaff|butler|room service|meal (delivery|included)/i,
		"FaUtensils",
	],
	[/grocer/i, "FaUtensils"],
	[/towel|bathrobe/i, "FaBath"],
	[
		/\bdvd\b|\bcd\b|ipod|in.?room movies|projector|media room|radio|stereo/i,
		"FaTv",
	],
	[/golf cart|airport pick|chauffeur|scooter|shuttle/i, "FaCar"],
	[/surf|windsurf|seabob|private dock|jet.?ski/i, "FaSailboat"],
	[/winter sport/i, "FaPersonSkiing"],
	[/golf course/i, "FaTreeCity"],
	[
		/bowling|\bgolf\b|volleyball|squash|basketball|racquetball|ping.?pong|batting cage|climbing wall|laser tag|skate|bocce|shuffleboard|card table/i,
		"FaTableTennisPaddleBall",
	],
	[/play ?ground|theme room/i, "FaChild"],
	[/fire alarm|emergency exit/i, "FaFireExtinguisher"],
	[/stair gate|ground floor/i, "FaStairs"],
	[/wide hallway|ceiling hoist|hypoallergenic/i, "FaWheelchair"],
	[/room.?darkening|connecting room/i, "FaBed"],
	[/mosquito net/i, "FaShield"],
	[/vacuum|trash compactor|dry clean/i, "FaSoap"],
	[
		/disinfect|sanitary|guest gap|cleaned with|common surface|cleaning (before|available|during)/i,
		"FaSoap",
	],
	[/trouser press/i, "FaShirt"],
	[/chimney/i, "FaFireFlameCurved"],
	[/telephone|fax|phone/i, "FaBellConcierge"],
	[/veranda|balcony|terrace/i, "FaTreeCity"],
	[/table and chair|dining table/i, "FaPlateWheat"],
	[/downtown|\btown\b|village|rural|resort|historic/i, "FaTreeCity"],
	[/romantic/i, "FaHouse"],
	[
		/concierge|host check|host greet|luggage|site staff|property manager|reception/i,
		"FaBellConcierge",
	],
	[
		/certification|cristal|tourism|safestay|safe stay|protocol|protected tourist|sg clean|cesco|intertek|\bhut\b|ahla|unplv/i,
		"FaShieldHeart",
	],
	[/no part(y|ies)|not sure/i, "FaBan"],
];

export function pickAmenityIcon(label: string): AmenityIconName {
	return (
		KEYWORD_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? DEFAULT_ICON
	);
}
