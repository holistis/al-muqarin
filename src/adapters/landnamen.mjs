// Country names as the sanctions lists write them, to ISO 3166-1 alpha-2. Used only for the hint "same country or not" next to a candidate:
// it never changes an outcome. So a name we do not know gives NO code (the hint then says "onbekend") and is never guessed.
// Historical names ("Former USSR (now Belarus)") are read through the modern name in brackets, and only when that name is known.
import { ISO_ALPHA2 } from '../countries.mjs';

const TABEL = {
  AF: ['Afghanistan'], AL: ['Albania'], DZ: ['Algeria'], AD: ['Andorra'], AO: ['Angola'], AR: ['Argentina'], AM: ['Armenia'], AU: ['Australia'],
  AT: ['Austria'], AZ: ['Azerbaijan'], BS: ['Bahamas', 'The Bahamas'], BH: ['Bahrain'], BD: ['Bangladesh'], BB: ['Barbados'], BY: ['Belarus'],
  BE: ['Belgium'], BZ: ['Belize'], BJ: ['Benin'], BT: ['Bhutan'], BO: ['Bolivia'], BA: ['Bosnia and Herzegovina', 'Bosnia-Herzegovina'],
  BW: ['Botswana'], BR: ['Brazil'], BN: ['Brunei', 'Brunei Darussalam'], BG: ['Bulgaria'], BF: ['Burkina Faso'], BI: ['Burundi'],
  KH: ['Cambodia'], CM: ['Cameroon'], CA: ['Canada'], CV: ['Cape Verde', 'Cabo Verde'], CF: ['Central African Republic'], TD: ['Chad'],
  CL: ['Chile'], CN: ['China', "People's Republic of China"], CO: ['Colombia'], KM: ['Comoros'],
  CG: ['Congo', 'Congo, Republic of the', 'Republic of the Congo', 'Congo (Brazzaville)'],
  CD: ['Democratic Republic of the Congo', 'Congo, Democratic Republic of the', 'Congo (Democratic Republic)', 'Congo (Kinshasa)', 'DRC'],
  CR: ['Costa Rica'], CI: ["Cote d'Ivoire", 'Ivory Coast'], HR: ['Croatia'], CU: ['Cuba'], CY: ['Cyprus'], CZ: ['Czechia', 'Czech Republic'],
  DK: ['Denmark'], DJ: ['Djibouti'], DM: ['Dominica'], DO: ['Dominican Republic'], EC: ['Ecuador'], EG: ['Egypt'], SV: ['El Salvador'],
  GQ: ['Equatorial Guinea'], ER: ['Eritrea'], EE: ['Estonia'], SZ: ['Eswatini', 'Swaziland'], ET: ['Ethiopia'], FJ: ['Fiji'], FI: ['Finland'],
  FR: ['France'], GA: ['Gabon'], GM: ['Gambia', 'The Gambia'], GE: ['Georgia'], DE: ['Germany'], GH: ['Ghana'], GR: ['Greece'], GD: ['Grenada'],
  GT: ['Guatemala'], GN: ['Guinea'], GW: ['Guinea-Bissau', 'Guinea Bissau'], GY: ['Guyana'], HT: ['Haiti'], HN: ['Honduras'], HK: ['Hong Kong'],
  HU: ['Hungary'], IS: ['Iceland'], IN: ['India'], ID: ['Indonesia'], IR: ['Iran', 'Iran (Islamic Republic of)', 'Islamic Republic of Iran'],
  IQ: ['Iraq'], IE: ['Ireland'], IL: ['Israel'], IT: ['Italy'], JM: ['Jamaica'], JP: ['Japan'], JO: ['Jordan'], KZ: ['Kazakhstan'], KE: ['Kenya'],
  KP: ['North Korea', 'Korea, North', "Democratic People's Republic of Korea", 'DPRK'],
  KR: ['South Korea', 'Korea, South', 'Republic of Korea'], KW: ['Kuwait'], KG: ['Kyrgyzstan'], LA: ['Laos', "Lao People's Democratic Republic"],
  LV: ['Latvia'], LB: ['Lebanon'], LS: ['Lesotho'], LR: ['Liberia'], LY: ['Libya'], LI: ['Liechtenstein'], LT: ['Lithuania'], LU: ['Luxembourg'],
  MO: ['Macau', 'Macao'], MG: ['Madagascar'], MW: ['Malawi'], MY: ['Malaysia'], MV: ['Maldives'], ML: ['Mali'], MT: ['Malta'],
  MR: ['Mauritania'], MU: ['Mauritius'], MX: ['Mexico'], MD: ['Moldova', 'Republic of Moldova'], MC: ['Monaco'], MN: ['Mongolia'],
  ME: ['Montenegro'], MA: ['Morocco'], MZ: ['Mozambique'], MM: ['Burma', 'Myanmar'], NA: ['Namibia'], NP: ['Nepal'], NL: ['Netherlands', 'The Netherlands'],
  NZ: ['New Zealand'], NI: ['Nicaragua'], NE: ['Niger'], NG: ['Nigeria'], MK: ['North Macedonia', 'North Macedonia, The Republic of', 'Macedonia'], NO: ['Norway'], OM: ['Oman'],
  PK: ['Pakistan'], PS: ['State of Palestine', 'Palestine'], PA: ['Panama'], PG: ['Papua New Guinea'], PY: ['Paraguay'], PE: ['Peru'],
  PH: ['Philippines'], PL: ['Poland'], PT: ['Portugal'], QA: ['Qatar'], RO: ['Romania'], RU: ['Russia', 'Russian Federation'], RW: ['Rwanda'],
  KN: ['St Kitts and Nevis', 'Saint Kitts and Nevis'], LC: ['St Lucia', 'Saint Lucia'], VC: ['Saint Vincent and the Grenadines'],
  SM: ['San Marino'], ST: ['Sao Tome and Principe'], SA: ['Saudi Arabia'], SN: ['Senegal'], RS: ['Serbia'], SC: ['Seychelles'],
  SL: ['Sierra Leone'], SG: ['Singapore'], SK: ['Slovakia'], SI: ['Slovenia'], SB: ['Solomon Islands'], SO: ['Somalia'], ZA: ['South Africa'],
  SS: ['South Sudan'], ES: ['Spain'], LK: ['Sri Lanka'], SD: ['Sudan'], SR: ['Suriname'], SE: ['Sweden'], CH: ['Switzerland'],
  SY: ['Syria', 'Syrian Arab Republic'], TW: ['Taiwan'], TJ: ['Tajikistan'], TZ: ['Tanzania', 'United Republic of Tanzania'], TH: ['Thailand'],
  TL: ['Timor-Leste', 'East Timor'], TG: ['Togo'], TT: ['Trinidad and Tobago'], TN: ['Tunisia'], TR: ['Turkey', 'Turkiye'], TM: ['Turkmenistan'],
  UG: ['Uganda'], UA: ['Ukraine'], AE: ['United Arab Emirates'], GB: ['United Kingdom', 'United Kingdom of Great Britain and Northern Ireland', 'UK'],
  US: ['United States', 'United States of America', 'USA'], UY: ['Uruguay'], UZ: ['Uzbekistan'], VU: ['Vanuatu'], VA: ['Holy See', 'Vatican City'],
  VE: ['Venezuela'], VN: ['Vietnam', 'Viet Nam'], YE: ['Yemen'], ZM: ['Zambia'], ZW: ['Zimbabwe'],
};

// Lower case, no accents, every run of other characters becomes one space.
const sleutel = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PER_NAAM = new Map();
for (const [code, namen] of Object.entries(TABEL)) {
  if (!ISO_ALPHA2.has(code)) throw new Error(`landnamen: ${code} is geen ISO-code`);
  for (const n of namen) {
    const k = sleutel(n);
    if (PER_NAAM.has(k) && PER_NAAM.get(k) !== code) throw new Error(`landnamen: ${n} staat bij twee landen`);
    PER_NAAM.set(k, code);
  }
}

// The ISO code for a country name, or undefined. "Former USSR (now Belarus)" and "Ukrainian SSR (now Ukraine)" are read as the country in brackets.
export function landCode(naam) {
  if (typeof naam !== 'string') return undefined;
  const k = sleutel(naam);
  if (PER_NAAM.has(k)) return PER_NAAM.get(k);
  const nu = /\b(?:now|currently)\s+(.+)$/.exec(k)?.[1];
  return nu && PER_NAAM.has(nu) ? PER_NAAM.get(nu) : undefined;
}
