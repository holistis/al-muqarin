#!/usr/bin/env node
// Usage: node tools/zelfmeting.mjs --snapshots snapshots --pub keys/muqarin-public.pem [--n 300] [--seed 1] [--out raw/zelfmeting.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { collectHits, entityIndex } from '../src/check.mjs';
import { loadSnapshot } from '../src/snapshot.mjs';
import { measureFalseAlarms, measureLeaveOneOut, measureMutations, measureOnderscheid, measureTriage } from './zelfmeting-lib.mjs';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const n = Number(a.n ?? 300), seed = Number(a.seed ?? 1);
const snap = loadSnapshot({ dir: a.snapshots, source: 'eu-fsf', pubKeyPem: readFileSync(a.pub, 'utf8'), now: new Date(), maxAgeDays: 8 });
if (!snap.ok) { console.error('snapshot niet bruikbaar:', snap.reason); process.exit(2); }
entityIndex(snap);

const COMPANIES = ['Apple Inc','Microsoft Corporation','Amazon.com Inc','Alphabet Inc','Meta Platforms','Nvidia Corporation','Tesla Inc','Toyota Motor Corporation','Volkswagen AG','BMW AG','Mercedes-Benz Group AG','Siemens AG','BASF SE','Bayer AG','SAP SE','Allianz SE','Deutsche Bank AG','Commerzbank AG','ING Groep','ABN AMRO','Rabobank','Philips','ASML Holding','Unilever','Shell plc','BP plc','TotalEnergies SE','Eni SpA','Equinor ASA','Nestle SA','Novartis AG','Roche Holding','UBS Group','HSBC Holdings','Barclays plc','Lloyds Banking Group','Standard Chartered','Vodafone Group','Telefonica SA','Orange SA','Deutsche Telekom','Airbus SE','Boeing Company','Lockheed Martin','Rolls-Royce Holdings','Safran SA','Thales Group','Samsung Electronics','Hyundai Motor Company','LG Electronics','SK Hynix','Sony Group','Honda Motor','Nissan Motor','Panasonic Holdings','Toshiba','Hitachi','Mitsubishi Corporation','Sumitomo Corporation','Alibaba Group','Tencent Holdings','Baidu Inc','Huawei Technologies','Xiaomi Corporation','Lenovo Group','BYD Company','Sinopec','PetroChina','Bank of China','China Construction Bank','Reliance Industries','Tata Motors','Infosys','Wipro','Petrobras','Vale SA','Itau Unibanco','Walmart Inc','Costco Wholesale','Home Depot','Procter and Gamble','Johnson and Johnson','Pfizer Inc','Moderna','Coca-Cola Company','PepsiCo','McDonalds Corporation','Starbucks','Nike Inc','Adidas AG','IKEA','Inditex','Maersk','DHL Group','FedEx','Glencore','Rio Tinto','BHP Group','Anglo American','Freeport-McMoRan','Barrick Gold','Newmont','Albemarle Corporation','Umicore','Northvolt','LG Energy Solution','Contemporary Amperex Technology'];
const WEST_F = ['John','Michael','David','James','Robert','Maria','Anna','Elena','Sophie','Emma','Peter','Thomas','Daniel','Laura','Sarah'];
const WEST_L = ['Smith','Jones','Brown','Garcia','Martin','Muller','Schmidt','Jansen','De Vries','Bakker','Visser','Meijer','Wilson','Taylor','Clark'];
const MIX_F = ['Mohammed','Ahmed','Ali','Omar','Hassan','Hussein','Khalid','Ibrahim','Yusuf','Mustafa','Ivan','Sergey','Alexander','Dmitry','Andrey','Vladimir','Nikolai','Mikhail','Oleg','Igor'];
const MIX_L = ['Hassan','Ali','Khan','Ahmed','Rahman','Ibrahim','Hussain','Petrov','Ivanov','Smirnov','Kuznetsov','Popov','Sokolov','Volkov','Morozov','Mahmoud','Said','Nasser','Farouk','Aziz'];
const combos = (f, l) => f.flatMap((x) => l.map((y) => `${x} ${y}`));

const report = {
  gemeten_op: new Date().toISOString(), seed, n,
  bron: { asOf: snap.manifest.asOf, partijen: snap.manifest.entryCount, namen_in_index: snap.index.length, overgeslagen_niet_latijns: snap.skipped },
  mutaties: measureMutations({ snap, seed, n }),
  alias_leave_one_out: measureLeaveOneOut({ snap, seed, n: Math.max(n, 800) }),
  vals_alarm_bedrijven: measureFalseAlarms({ snap, names: COMPANIES }),
  vals_alarm_personen_westers: measureFalseAlarms({ snap, names: combos(WEST_F, WEST_L) }),
  vals_alarm_personen_arabisch_russisch: measureFalseAlarms({ snap, names: combos(MIX_F, MIX_L) }),
  aanwijzing_veiligheid: measureOnderscheid({ snap, seed, n }),
  aanwijzing_triage_arabisch_russisch: measureTriage({ snap, seed, names: combos(MIX_F, MIX_L) }),
};
if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 2));
const line = (k, s) => console.log(k.padEnd(14), `${s.gevonden_pct}% gevonden`.padEnd(18), `(exact ${s.exact_pct}%, n=${s.geprobeerd}, onmeetbaar ${s.onmeetbaar})`, JSON.stringify(Object.fromEntries(Object.entries(s.per_lengte).map(([b, v]) => [b, v.gevonden_pct + '%']))));
for (const [k, s] of Object.entries(report.mutaties)) line(k, s);
const L = report.alias_leave_one_out;
console.log('alias zonder zichzelf:', `${L.gevonden_pct}% van ${L.geprobeerd}`, JSON.stringify(L.per_reden), `(${L.entiteiten_met_meerdere_schrijfwijzen} partijen met meerdere schrijfwijzen)`);
for (const k of ['vals_alarm_bedrijven', 'vals_alarm_personen_westers', 'vals_alarm_personen_arabisch_russisch']) console.log(k.padEnd(40), `${report[k].alarm_pct}% alarm`, `(treffer ${report[k].treffer}, kandidaat ${report[k].kandidaat}, van ${report[k].geprobeerd})`);
console.log('aanwijzing veiligheid:', JSON.stringify(report.aanwijzing_veiligheid));
console.log('aanwijzing triage    :', JSON.stringify(report.aanwijzing_triage_arabisch_russisch));
