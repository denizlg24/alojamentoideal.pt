// ISO 3166-1 alpha-2 country codes. Display names are resolved at runtime via
// `Intl.DisplayNames` so we do not ship a localized name table; the labels then
// follow the user's locale automatically.
const RAW_CODES =
	"AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

export const COUNTRY_CODES: readonly string[] = RAW_CODES.split(" ");

const regionNames =
	typeof Intl !== "undefined" && "DisplayNames" in Intl
		? new Intl.DisplayNames(["en"], { type: "region" })
		: null;

export function countryName(code: string | null | undefined): string {
	if (!code) {
		return "";
	}
	try {
		return regionNames?.of(code) ?? code;
	} catch {
		return code;
	}
}

// International dialing codes (digits only) keyed by ISO-2. Uninhabited
// territories without a real code (BV, HM) are intentionally omitted.
const DIAL_CODES: Record<string, string> = {
	AD: "376",
	AE: "971",
	AF: "93",
	AG: "1",
	AI: "1",
	AL: "355",
	AM: "374",
	AO: "244",
	AQ: "672",
	AR: "54",
	AS: "1",
	AT: "43",
	AU: "61",
	AW: "297",
	AX: "358",
	AZ: "994",
	BA: "387",
	BB: "1",
	BD: "880",
	BE: "32",
	BF: "226",
	BG: "359",
	BH: "973",
	BI: "257",
	BJ: "229",
	BL: "590",
	BM: "1",
	BN: "673",
	BO: "591",
	BQ: "599",
	BR: "55",
	BS: "1",
	BT: "975",
	BW: "267",
	BY: "375",
	BZ: "501",
	CA: "1",
	CC: "61",
	CD: "243",
	CF: "236",
	CG: "242",
	CH: "41",
	CI: "225",
	CK: "682",
	CL: "56",
	CM: "237",
	CN: "86",
	CO: "57",
	CR: "506",
	CU: "53",
	CV: "238",
	CW: "599",
	CX: "61",
	CY: "357",
	CZ: "420",
	DE: "49",
	DJ: "253",
	DK: "45",
	DM: "1",
	DO: "1",
	DZ: "213",
	EC: "593",
	EE: "372",
	EG: "20",
	EH: "212",
	ER: "291",
	ES: "34",
	ET: "251",
	FI: "358",
	FJ: "679",
	FK: "500",
	FM: "691",
	FO: "298",
	FR: "33",
	GA: "241",
	GB: "44",
	GD: "1",
	GE: "995",
	GF: "594",
	GG: "44",
	GH: "233",
	GI: "350",
	GL: "299",
	GM: "220",
	GN: "224",
	GP: "590",
	GQ: "240",
	GR: "30",
	GS: "500",
	GT: "502",
	GU: "1",
	GW: "245",
	GY: "592",
	HK: "852",
	HN: "504",
	HR: "385",
	HT: "509",
	HU: "36",
	ID: "62",
	IE: "353",
	IL: "972",
	IM: "44",
	IN: "91",
	IO: "246",
	IQ: "964",
	IR: "98",
	IS: "354",
	IT: "39",
	JE: "44",
	JM: "1",
	JO: "962",
	JP: "81",
	KE: "254",
	KG: "996",
	KH: "855",
	KI: "686",
	KM: "269",
	KN: "1",
	KP: "850",
	KR: "82",
	KW: "965",
	KY: "1",
	KZ: "7",
	LA: "856",
	LB: "961",
	LC: "1",
	LI: "423",
	LK: "94",
	LR: "231",
	LS: "266",
	LT: "370",
	LU: "352",
	LV: "371",
	LY: "218",
	MA: "212",
	MC: "377",
	MD: "373",
	ME: "382",
	MF: "590",
	MG: "261",
	MH: "692",
	MK: "389",
	ML: "223",
	MM: "95",
	MN: "976",
	MO: "853",
	MP: "1",
	MQ: "596",
	MR: "222",
	MS: "1",
	MT: "356",
	MU: "230",
	MV: "960",
	MW: "265",
	MX: "52",
	MY: "60",
	MZ: "258",
	NA: "264",
	NC: "687",
	NE: "227",
	NF: "672",
	NG: "234",
	NI: "505",
	NL: "31",
	NO: "47",
	NP: "977",
	NR: "674",
	NU: "683",
	NZ: "64",
	OM: "968",
	PA: "507",
	PE: "51",
	PF: "689",
	PG: "675",
	PH: "63",
	PK: "92",
	PL: "48",
	PM: "508",
	PN: "64",
	PR: "1",
	PS: "970",
	PT: "351",
	PW: "680",
	PY: "595",
	QA: "974",
	RE: "262",
	RO: "40",
	RS: "381",
	RU: "7",
	RW: "250",
	SA: "966",
	SB: "677",
	SC: "248",
	SD: "249",
	SE: "46",
	SG: "65",
	SH: "290",
	SI: "386",
	SJ: "47",
	SK: "421",
	SL: "232",
	SM: "378",
	SN: "221",
	SO: "252",
	SR: "597",
	SS: "211",
	ST: "239",
	SV: "503",
	SX: "1",
	SY: "963",
	SZ: "268",
	TC: "1",
	TD: "235",
	TF: "262",
	TG: "228",
	TH: "66",
	TJ: "992",
	TK: "690",
	TL: "670",
	TM: "993",
	TN: "216",
	TO: "676",
	TR: "90",
	TT: "1",
	TV: "688",
	TW: "886",
	TZ: "255",
	UA: "380",
	UG: "256",
	UM: "1",
	US: "1",
	UY: "598",
	UZ: "998",
	VA: "39",
	VC: "1",
	VE: "58",
	VG: "1",
	VI: "1",
	VN: "84",
	VU: "678",
	WF: "681",
	WS: "685",
	YE: "967",
	YT: "262",
	ZA: "27",
	ZM: "260",
	ZW: "263",
};

// Preferred country to show when several share a dialing code, so a +44 number
// reads as the United Kingdom rather than an alphabetically-first dependency.
const PRIMARY_DIAL_COUNTRY: Record<string, string> = {
	"1": "US",
	"7": "RU",
	"39": "IT",
	"44": "GB",
	"47": "NO",
	"61": "AU",
	"212": "MA",
	"262": "RE",
	"358": "FI",
	"590": "GP",
	"599": "CW",
};

/**
 * Regional-indicator flag emoji for an ISO-2 code (e.g. "PT" -> 🇵🇹). Renders as
 * a flag on iOS/Android/macOS; Windows lacks flag glyphs and shows the letters.
 */
export function countryFlag(code: string | null | undefined): string {
	if (code?.length !== 2) {
		return "";
	}
	const upper = code.toUpperCase();
	const first = upper.codePointAt(0);
	const second = upper.codePointAt(1);
	if (first === undefined || second === undefined) {
		return "";
	}
	const offset = 0x1f1e6 - 65;
	return String.fromCodePoint(offset + first, offset + second);
}

/** International dialing code (digits only, no "+") for an ISO-2 code. */
export function dialCode(code: string | null | undefined): string | null {
	return code ? (DIAL_CODES[code.toUpperCase()] ?? null) : null;
}

/** Resolves the country to display for a dialing code, honoring primaries. */
export function countryForDialCode(dial: string): string | null {
	return PRIMARY_DIAL_COUNTRY[dial] ?? null;
}

export interface CountryOption {
	code: string;
	name: string;
	flag: string;
	dialCode: string | null;
}

/** All countries sorted by display name, for country select inputs. */
export const COUNTRY_OPTIONS: CountryOption[] = COUNTRY_CODES.map((code) => ({
	code,
	dialCode: dialCode(code),
	flag: countryFlag(code),
	name: countryName(code),
})).sort((a, b) => a.name.localeCompare(b.name));

export interface PhoneCountryOption {
	code: string;
	name: string;
	flag: string;
	dialCode: string;
}

/** Countries that have a dialing code, for the phone-number country picker. */
export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] =
	COUNTRY_OPTIONS.filter(
		(option): option is CountryOption & { dialCode: string } =>
			option.dialCode !== null,
	).map((option) => ({
		code: option.code,
		dialCode: option.dialCode,
		flag: option.flag,
		name: option.name,
	}));
