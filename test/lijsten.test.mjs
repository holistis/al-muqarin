// The parsers of the lists besides the EU one: UN, OFAC and UK, and the helpers they share (records, country names).
// The fixtures copy the shape of the real files (checked 2026-11-08) but hold only what a test needs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { landCode } from '../src/adapters/landnamen.mjs';
import { parseOfacSdn } from '../src/adapters/ofac-sdn.mjs';
import { parseEuFsf } from '../src/adapters/eu-fsf.mjs';
import { alleTeksten, blokken, decode, eindeControle, records, tekst, zonder } from '../src/adapters/records.mjs';
import { parseUkSanctions } from '../src/adapters/uk-sanctions.mjs';
import { parseUnSc } from '../src/adapters/un-sc.mjs';
import { runCheck } from '../src/check.mjs';
import { ISO_ALPHA2 } from '../src/countries.mjs';
import { NOW, cleanup, keypair, tmpRoot, writeSnapshot } from './fixture.mjs';

describe('shared helpers', () => {
  it('records: gives the attributes and the inside, and skips tags that only start with the same letters', () => {
    const xml = '<L><Item a="1">x</Item><Items>no</Items><Item_Alias>no</Item_Alias><Item>y</Item></L>';
    assert.deepEqual([...records(xml, 'Item')], [[' a="1"', 'x'], ['', 'y']]);
  });
  it('records: refuses a record that is not closed, closed too late, or empty', () => {
    assert.throws(() => [...records('<Item>x', 'Item')], /niet gesloten/);
    assert.throws(() => [...records('<Item', 'Item')], /niet gesloten/);
    assert.throws(() => [...records('<Item><Item>x</Item></Item>', 'Item')], /niet gesloten voor de volgende/);
    assert.throws(() => [...records('<Item/>', 'Item')], /lege entiteit/);
  });
  it('decode: named and numeric references; a reference to no character is an error, an unknown name stays as written', () => {
    assert.equal(decode('A &amp; B &lt;&gt; &quot;&apos; &#233; &#xE9;'), `A & B <> "' é é`);
    assert.equal(decode('&nbsp;'), '&nbsp;');
    assert.throws(() => decode('&#99999999;'), /tekenverwijzing/);
  });
  it('tekst and alleTeksten: trimmed and decoded, empty ones are nothing', () => {
    const x = '<A> one &amp; two </A><A/><A>  </A><A>three</A>';
    assert.equal(tekst(x, 'A'), 'one & two');
    assert.equal(tekst('<A/>', 'A'), undefined);
    assert.deepEqual(alleTeksten(x, 'A'), ['one & two', 'three']);
  });
  it('blokken: the inside of each block, and nothing for a self-closing one', () => {
    assert.deepEqual([...blokken('<B>1</B><B/><B>2\n3</B><Bx>4</Bx>', 'B')], ['1', '2\n3']);
  });
});

describe('country names', () => {
  it('every code in the table is an official ISO code (the module refuses to load otherwise) and names resolve', () => {
    assert.equal(landCode('Russia'), 'RU');
    assert.equal(landCode('Russian Federation'), 'RU');
    assert.equal(landCode('  iran (islamic republic of) '), 'IR');
    assert.equal(landCode("Democratic People's Republic of Korea"), 'KP');
    assert.equal(landCode('Korea, North'), 'KP');
    assert.equal(landCode('Türkiye'), 'TR');
    assert.equal(landCode("Cote d'Ivoire"), 'CI');
    assert.equal(landCode('North Macedonia, The Republic of'), 'MK');
    assert.ok(ISO_ALPHA2.has(landCode('Congo')) && landCode('Congo') !== landCode('Democratic Republic of the Congo'));
  });
  it('a historical name is read through the modern name behind "now" or "currently", when that one is known', () => {
    assert.equal(landCode('Former USSR (now Belarus)'), 'BY');
    assert.equal(landCode('Former USSR, currently Ukraine'), 'UA');
    assert.equal(landCode('Kazakh Soviet Socialist Republic (now Kazakhstan)'), 'KZ');
    assert.equal(landCode('Russian SFSR, (now Russian Federation)'), 'RU');
  });
  it('what it does not know it leaves out, never guesses', () => {
    for (const naam of ['Palestinian', 'Kosovo', 'former Soviet Union', 'na', '', 'Atlantis', 'Russia (USSR)', 'Moldovian SSR (now Republic of Moldovia)']) assert.equal(landCode(naam), undefined, naam);
    assert.equal(landCode(undefined), undefined);
    assert.equal(landCode(42), undefined);
  });
});

const un = (body, gen = '2026-11-08T00:00:00.869Z') => `<?xml version="1.0"?><CONSOLIDATED_LIST xmlns:xsi="x" dateGenerated="${gen}">${body}</CONSOLIDATED_LIST>`;
const unPerson = (inner) => `<INDIVIDUAL><DATAID>6907993</DATAID><VERSIONNUM>1</VERSIONNUM>${inner}</INDIVIDUAL>`;

describe('UN list parser', () => {
  it('reads individuals and entities, with the date the file was generated', () => {
    const r = parseUnSc(un('<INDIVIDUALS>' + unPerson('<FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>') + '</INDIVIDUALS><ENTITIES><ENTITY><DATAID>2</DATAID><FIRST_NAME>ADF</FIRST_NAME><REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER><ENTITY_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>Allied Democratic Forces</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES>'));
    assert.equal(r.asOf, '2026-11-08');
    assert.deepEqual(r.entries, [
      { id: 'CDi.001', names: ['ERIC BADEGE'], soort: 'persoon' },
      { id: 'CDe.001', names: ['ADF', 'Allied Democratic Forces'], soort: 'onderneming' },
    ]);
  });
  it('writes the name parts in order and leaves out the "na" placeholders', () => {
    const r = parseUnSc(un(unPerson('<FIRST_NAME>FRANK KAKOLELE</FIRST_NAME><SECOND_NAME>BWAMBALE</SECOND_NAME><THIRD_NAME>na</THIRD_NAME><FOURTH_NAME>Jr</FOURTH_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER>')));
    assert.deepEqual(r.entries[0].names, ['FRANK KAKOLELE BWAMBALE Jr']);
  });
  it('splits an alias field on semicolons, drops empty aliases and placeholders, keeps the name in the original script', () => {
    const r = parseUnSc(un(unPerson('<FIRST_NAME>AZIM</FIRST_NAME><REFERENCE_NUMBER>IRi.003</REFERENCE_NUMBER><NAME_ORIGINAL_SCRIPT>عظیم</NAME_ORIGINAL_SCRIPT><INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Azim Adhajani; Azim Agha-Jani;  ; na</ALIAS_NAME></INDIVIDUAL_ALIAS><INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS>')));
    assert.deepEqual(r.entries[0].names, ['AZIM', 'Azim Adhajani', 'Azim Agha-Jani', 'عظیم']);
  });
  it('decodes xml references in names', () => {
    assert.deepEqual(parseUnSc(un(unPerson('<FIRST_NAME>A &amp; B</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER>'))).entries[0].names, ['A & B']);
  });
  const dob = (inner) => parseUnSc(un(unPerson(`<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER><INDIVIDUAL_DATE_OF_BIRTH>${inner}</INDIVIDUAL_DATE_OF_BIRTH>`))).entries[0];
  it('birth years: an exact year, the year of an exact date, "approximately" as such', () => {
    assert.deepEqual(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1971</YEAR>').jaren, [1971]);
    assert.equal(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1971</YEAR>').ongeveer, undefined);
    assert.deepEqual(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><DATE>1967-01-01</DATE>').jaren, [1967]);
    const a = dob('<TYPE_OF_DATE>APPROXIMATELY</TYPE_OF_DATE><YEAR>1980</YEAR>');
    assert.deepEqual([a.jaren, a.ongeveer], [[1980], true]);
  });
  it('birth years: several dates are sorted, whatever their order in the file', () => {
    const r = parseUnSc(un(unPerson('<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER><INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1990</YEAR></INDIVIDUAL_DATE_OF_BIRTH><INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1980</YEAR></INDIVIDUAL_DATE_OF_BIRTH>')));
    assert.deepEqual(r.entries[0].jaren, [1980, 1990]);
  });
  it('birth years: a range is written out year by year (and is not "approximately"); a wide or wrong range is not used', () => {
    const b = dob('<TYPE_OF_DATE>BETWEEN</TYPE_OF_DATE><FROM_YEAR>1959</FROM_YEAR><TO_YEAR>1962</TO_YEAR>');
    assert.deepEqual([b.jaren, b.ongeveer], [[1959, 1960, 1961, 1962], undefined]);
    assert.equal(dob('<TYPE_OF_DATE>BETWEEN</TYPE_OF_DATE><FROM_YEAR>1950</FROM_YEAR><TO_YEAR>1970</TO_YEAR>').jaren, undefined);
    assert.equal(dob('<TYPE_OF_DATE>BETWEEN</TYPE_OF_DATE><FROM_YEAR>1962</FROM_YEAR><TO_YEAR>1959</TO_YEAR>').jaren, undefined);
  });
  it('birth years: a year outside 1800 to 2200 or not a number is left out, and never stops the run', () => {
    assert.equal(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1000</YEAR>').jaren, undefined);
    assert.equal(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>abcd</YEAR>').jaren, undefined);
    assert.equal(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>2300</YEAR>').jaren, undefined);
    assert.equal(dob('<TYPE_OF_DATE>EXACT</TYPE_OF_DATE>').jaren, undefined);
  });
  it('countries: nationality and country of birth as codes, sorted, what is unknown left out, empty blocks harmless', () => {
    const r = parseUnSc(un(unPerson('<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER><NATIONALITY><VALUE>Syrian Arab Republic</VALUE><VALUE>former Soviet Union</VALUE><VALUE>na</VALUE></NATIONALITY><NATIONALITY/><INDIVIDUAL_PLACE_OF_BIRTH><COUNTRY>Iraq</COUNTRY></INDIVIDUAL_PLACE_OF_BIRTH><INDIVIDUAL_PLACE_OF_BIRTH><COUNTRY/></INDIVIDUAL_PLACE_OF_BIRTH>')));
    assert.deepEqual(r.entries[0].landen, ['IQ', 'SY']);
  });
  it('the id is the reference number, then the data id; neither is an error', () => {
    assert.equal(parseUnSc(un(unPerson('<FIRST_NAME>X</FIRST_NAME>'))).entries[0].id, '6907993');
    assert.throws(() => parseUnSc(un('<INDIVIDUAL><FIRST_NAME>X</FIRST_NAME></INDIVIDUAL>')), /zonder id/);
  });
  it('a missing date, an unclosed record or an empty one is an error', () => {
    assert.throws(() => parseUnSc('<CONSOLIDATED_LIST></CONSOLIDATED_LIST>'), /dateGenerated/);
    assert.throws(() => parseUnSc(un('<INDIVIDUAL><DATAID>1</DATAID>')), /niet gesloten/);
    assert.throws(() => parseUnSc(un('<INDIVIDUAL/>')), /lege entiteit/);
  });
  it('an empty list yields zero entries (the feeder rejects that by its floor)', () => assert.equal(parseUnSc(un('<INDIVIDUALS></INDIVIDUALS>')).entries.length, 0));
});

const ofac = (body, { datum = '11/06/2026', aantal } = {}) => {
  const n = aantal ?? (body.match(/<sdnEntry>/g) ?? []).length;
  return `<?xml version="1.0"?><sdnList xmlns="x"><publshInformation><Publish_Date>${datum}</Publish_Date><Record_Count>${n}</Record_Count></publshInformation>${body}</sdnList>`;
};
const sdn = (inner) => `<sdnEntry>${inner}</sdnEntry>`;

describe('OFAC SDN parser', () => {
  it('takes the id of the entry itself, not of an alias or an address inside it, and reads the type', () => {
    const r = parseOfacSdn(ofac(
      sdn('<uid>2674</uid><firstName>Abu</firstName><lastName>ABBAS</lastName><sdnType>Individual</sdnType><programList><program>SDGT</program></programList><akaList><aka><uid>1795</uid><type>a.k.a.</type><category>strong</category><lastName>ZAYDAN</lastName><firstName>Muhammad</firstName></aka></akaList><addressList><address><uid>77</uid><country>Egypt</country></address></addressList>')
      + sdn('<uid>36</uid><lastName>AEROCARIBBEAN AIRLINES</lastName><sdnType>Entity</sdnType>')
      + sdn('<uid>4238</uid><lastName>MAR AZUL</lastName><sdnType>Vessel</sdnType><vesselInfo><callSign>CL2192</callSign><vesselOwner>Samir</vesselOwner></vesselInfo>')
      + sdn('<uid>5</uid><lastName>PLANE</lastName><sdnType>Aircraft</sdnType>'),
    ));
    assert.equal(r.asOf, '2026-11-06');
    assert.deepEqual(r.entries.map((e) => [e.id, e.soort, e.names]), [
      ['2674', 'persoon', ['Abu ABBAS', 'Muhammad ZAYDAN']],
      ['36', 'onderneming', ['AEROCARIBBEAN AIRLINES']],
      ['4238', 'voertuig', ['MAR AZUL']],
      ['5', 'voertuig', ['PLANE']],
    ]);
  });
  it('the order of the fields inside an entry does not matter: a list of aliases in front does not change the id or the name', () => {
    const r = parseOfacSdn(ofac(sdn('<akaList><aka><uid>1795</uid><type>a.k.a.</type><lastName>ZAYDAN</lastName><firstName>Muhammad</firstName></aka></akaList><addressList><address><uid>77</uid><country>Egypt</country></address></addressList><uid>2674</uid><firstName>Abu</firstName><lastName>ABBAS</lastName><sdnType>Individual</sdnType>')));
    assert.deepEqual(r.entries[0], { id: '2674', names: ['Abu ABBAS', 'Muhammad ZAYDAN'], soort: 'persoon' });
  });
  it('an entry without a type is "onbekend", and an entry without an id is an error', () => {
    assert.equal(parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName>'))).entries[0].soort, 'onbekend');
    assert.throws(() => parseOfacSdn(ofac(sdn('<lastName>X</lastName><akaList><aka><uid>9</uid><lastName>Y</lastName></aka></akaList>'))), /zonder id/);
  });
  const dob = (...datums) => parseOfacSdn(ofac(sdn(`<uid>1</uid><lastName>X</lastName><sdnType>Individual</sdnType><dateOfBirthList>${datums.map((d) => `<dateOfBirthItem><uid>9</uid><dateOfBirth>${d}</dateOfBirth></dateOfBirthItem>`).join('')}</dateOfBirthList>`))).entries[0];
  it('birth years: a full date, a year, several dates', () => {
    assert.deepEqual(dob('10 Dec 1948').jaren, [1948]);
    assert.deepEqual(dob('1963', '15 Jul 1943').jaren, [1943, 1963]);
    assert.equal(dob('10 Dec 1948').ongeveer, undefined);
  });
  it('birth years: "circa" is approximate, a "to" range is written out, a long one is not', () => {
    const c = dob('circa 1951');
    assert.deepEqual([c.jaren, c.ongeveer], [[1951], true]);
    assert.deepEqual(dob('1951 to 1953').jaren, [1951, 1952, 1953]);
    assert.deepEqual(dob('1940 to 1970').jaren, [1940, 1970]);
    assert.deepEqual(dob('1953 to 1951').jaren, [1951, 1953]);
  });
  it('birth years: two years in one text without "to" are two years, not a range', () => assert.deepEqual(dob('1951 or 1953').jaren, [1951, 1953]));
  it('birth years: a text with no usable year gives none, and "circa" without a year does not mark the entry', () => {
    const e = dob('circa unknown', '1000');
    assert.equal(e.jaren, undefined);
    assert.equal(e.ongeveer, undefined);
  });
  it('birth years and countries come out sorted', () => {
    const r = parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName><sdnType>Individual</sdnType><nationalityList><nationality><country>Syria</country></nationality><nationality><country>Iraq</country></nationality></nationalityList><dateOfBirthList><dateOfBirthItem><dateOfBirth>1990</dateOfBirth></dateOfBirthItem><dateOfBirthItem><dateOfBirth>1980</dateOfBirth></dateOfBirthItem></dateOfBirthList>')));
    assert.deepEqual([r.entries[0].jaren, r.entries[0].landen], [[1980, 1990], ['IQ', 'SY']]);
  });
  it('countries: nationality, citizenship and the last part of the place of birth', () => {
    const r = parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName><sdnType>Individual</sdnType><nationalityList><nationality><uid>2</uid><country>Egypt</country></nationality></nationalityList><citizenshipList><citizenship><uid>3</uid><country>Syria</country></citizenship></citizenshipList><placeOfBirthList><placeOfBirthItem><uid>4</uid><placeOfBirth>Mosul, Iraq</placeOfBirth></placeOfBirthItem><placeOfBirthItem><uid>5</uid><placeOfBirth>Nowhereville</placeOfBirth></placeOfBirthItem></placeOfBirthList><addressList><address><uid>6</uid><country>Russia</country></address></addressList>')));
    assert.deepEqual(r.entries[0].landen, ['EG', 'IQ', 'SY']);
  });
  it('decodes xml references in names', () => assert.deepEqual(parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>A &amp; B</lastName>'))).entries[0].names, ['A & B']));
  it('the number of entries must equal the number the file states about itself', () => {
    assert.throws(() => parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName>'), { aantal: 2 })), /aantal klopt niet/);
    assert.throws(() => parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName>') + sdn('<uid>2</uid><lastName>Y</lastName>'), { aantal: 1 })), /aantal klopt niet/);
    assert.equal(parseOfacSdn(ofac('', { aantal: 0 })).entries.length, 0);
  });
  it('a missing or wrong date or count is an error', () => {
    assert.throws(() => parseOfacSdn('<sdnList><Record_Count>0</Record_Count></sdnList>'), /Publish_Date ontbreekt/);
    assert.throws(() => parseOfacSdn(ofac('', { datum: '13/06/2026', aantal: 0 })), /Publish_Date ongeldig/);
    assert.throws(() => parseOfacSdn(ofac('', { datum: '11/32/2026', aantal: 0 })), /Publish_Date ongeldig/);
    assert.throws(() => parseOfacSdn(ofac('', { datum: '00/10/2026', aantal: 0 })), /Publish_Date ongeldig/);
    assert.throws(() => parseOfacSdn(ofac('', { datum: '11/00/2026', aantal: 0 })), /Publish_Date ongeldig/);
    assert.throws(() => parseOfacSdn('<sdnList><Publish_Date>11/06/2026</Publish_Date></sdnList>'), /Record_Count ontbreekt/);
  });
  it('an unclosed or empty entry is an error', () => {
    assert.throws(() => parseOfacSdn(ofac(sdn('<uid>1</uid>') + '<sdnEntry><uid>2</uid>', { aantal: 2 })), /niet gesloten/);
    assert.throws(() => parseOfacSdn(ofac('<sdnEntry/>', { aantal: 1 })), /lege entiteit/);
  });
});

const uk = (body, datum = '03/11/2026') => `<?xml version="1.0"?><Designations><DateGenerated>${datum}</DateGenerated>${body}</Designations>`;
const naam = (delen, type = 'Primary Name') => `<Name>${Object.entries(delen).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}<NameType>${type}</NameType></Name>`;
const desig = (id, inner) => `<Designation><LastUpdated>14/04/2026</LastUpdated><UniqueID>${id}</UniqueID>${inner}</Designation>`;

describe('UK list parser', () => {
  it('writes a full name from its parts in order, takes every name block, and reads the type', () => {
    const r = parseUkSanctions(uk(
      desig('AFG0006', `<Names>${naam({ Name1: 'MOHAMMAD', Name2: 'HASSAN', Name6: 'AKHUND' })}${naam({ Name6: 'Mullah Hassan' }, 'Alias')}</Names><IndividualEntityShip>Individual</IndividualEntityShip>`)
      + desig('AFG0001', `<Names>${naam({ Name6: 'HAJI KHAIRULLAH MONEY EXCHANGE' })}</Names><IndividualEntityShip>Entity</IndividualEntityShip>`)
      + desig('DPR0075', `<Names>${naam({ Name6: 'Petrel 8' })}</Names><IndividualEntityShip>Ship</IndividualEntityShip>`)
      + desig('X1', `<Names>${naam({ Name6: 'No Type' })}</Names>`),
    ));
    assert.equal(r.asOf, '2026-11-03');
    assert.deepEqual(r.entries.map((e) => [e.id, e.soort, e.names]), [
      ['AFG0006', 'persoon', ['MOHAMMAD HASSAN AKHUND', 'Mullah Hassan']],
      ['AFG0001', 'onderneming', ['HAJI KHAIRULLAH MONEY EXCHANGE']],
      ['DPR0075', 'voertuig', ['Petrel 8']],
      ['X1', 'onbekend', ['No Type']],
    ]);
  });
  it('all six name parts are used, a name block with no letters adds nothing, and the original script is kept', () => {
    const r = parseUkSanctions(uk(desig('A1', `<Names>${naam({ Name1: 'A', Name2: 'B', Name3: 'C', Name4: 'D', Name5: 'E', Name6: 'F' })}<Name><NameType>Primary Name Variation</NameType></Name></Names><NonLatinNames><NonLatinName><NameNonLatinScript>حسن</NameNonLatinScript></NonLatinName></NonLatinNames>`)));
    assert.deepEqual(r.entries[0].names, ['A B C D E F', 'حسن']);
  });
  it('decodes xml references in names', () => assert.deepEqual(parseUkSanctions(uk(desig('A1', `<Names>${naam({ Name6: 'B&amp;H Central' })}</Names>`))).entries[0].names, ['B&H Central']));
  it('birth years from the partial dates the list uses', () => {
    const r = parseUkSanctions(uk(desig('A1', '<Names></Names><IndividualDetails><Individual><DOBs><DOB>dd/mm/1945</DOB><DOB>13/04/1964</DOB><DOB>1950</DOB><DOB>dd/mm/1000</DOB><DOB>onbekend</DOB></DOBs></Individual></IndividualDetails>')));
    assert.deepEqual(r.entries[0].jaren, [1945, 1950, 1964]);
    assert.equal(r.entries[0].ongeveer, undefined);
  });
  it('years and countries come out sorted', () => {
    const r = parseUkSanctions(uk(desig('A1', '<Names></Names><IndividualDetails><Individual><DOBs><DOB>01/01/1990</DOB><DOB>01/01/1980</DOB></DOBs><Nationalities><Nationality>Syria</Nationality><Nationality>Iraq</Nationality></Nationalities></Individual></IndividualDetails>')));
    assert.deepEqual([r.entries[0].jaren, r.entries[0].landen], [[1980, 1990], ['IQ', 'SY']]);
  });
  it('countries: nationality and country of birth, what is unknown left out', () => {
    const r = parseUkSanctions(uk(desig('A1', '<Names></Names><IndividualDetails><Individual><Nationalities><Nationality>Afghanistan</Nationality><Nationality>Former USSR</Nationality></Nationalities><BirthDetails><Location><TownOfBirth>Kabul</TownOfBirth><CountryOfBirth>Pakistan</CountryOfBirth></Location></BirthDetails></Individual></IndividualDetails><Addresses><Address><AddressCountry>Russia</AddressCountry></Address></Addresses>')));
    assert.deepEqual(r.entries[0].landen, ['AF', 'PK']);
  });
  it('an entry with nothing but names has no years and no countries', () => {
    const e = parseUkSanctions(uk(desig('A1', `<Names>${naam({ Name6: 'X' })}</Names>`))).entries[0];
    assert.deepEqual(Object.keys(e).sort(), ['id', 'names', 'soort']);
  });
  it('a designation without an id, a missing or wrong date, an unclosed designation: all errors', () => {
    assert.throws(() => parseUkSanctions(uk('<Designation><Names></Names></Designation>')), /zonder id/);
    assert.throws(() => parseUkSanctions('<Designations></Designations>'), /DateGenerated ontbreekt/);
    assert.throws(() => parseUkSanctions(uk('', '03/13/2026')), /DateGenerated ongeldig/);
    assert.throws(() => parseUkSanctions(uk('', '32/11/2026')), /DateGenerated ongeldig/);
    assert.throws(() => parseUkSanctions(uk('', '00/11/2026')), /DateGenerated ongeldig/);
    assert.throws(() => parseUkSanctions(uk('', '03/00/2026')), /DateGenerated ongeldig/);
    assert.throws(() => parseUkSanctions(uk('<Designation><UniqueID>A</UniqueID>')), /niet gesloten/);
  });
  it('the plural wrapper is not mistaken for a designation', () => assert.equal(parseUkSanctions(uk('')).entries.length, 0));
});

// A ship called MARIA must not flag every person called Maria; a company with the same single word still does.
describe('ships and aircraft in the matching', () => {
  const K = keypair();
  const dir = tmpRoot();
  const filler = Array.from({ length: 12 }, (_, i) => ({ id: `F${i}`, names: [`Filler Company Number ${i} Xq${i}z`], soort: 'onderneming' }));
  const lijst = (soortVanMaria) => [{ id: 'S1', names: ['MARIA'], soort: soortVanMaria }, { id: 'E1', names: ['ZORBAS'], soort: 'onderneming' }, { id: 'S2', names: ['ZORBAS II'], soort: 'voertuig' }, ...filler];
  const vraag = (value, soort) => {
    writeSnapshot(dir, 'eu-fsf', lijst(soort), K.priv);
    return runCheck({ claims: [{ id: 'a', type: 'entity', value }], snapshotDir: dir, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: ['cahras'] } }).resultaten[0];
  };
  it('a single-word ship name does not flag a claim that merely contains the word', () => {
    assert.equal(vraag('Maria Jansen', 'voertuig').uitkomst, 'GEEN_TREFFER_IN_LIJST');
  });
  it('the same word as a company of unknown or known type still flags the claim (the rule is kept for them)', () => {
    assert.equal(vraag('Maria Jansen', 'onderneming').uitkomst, 'KANDIDAAT');
    assert.equal(vraag('Maria Jansen', 'onbekend').uitkomst, 'KANDIDAAT');
  });
  it('a ship is still found by its own name, exact', () => assert.equal(vraag('Maria', 'voertuig').uitkomst, 'TREFFER'));
  it('a person-type entry is not flagged this way either', () => assert.equal(vraag('Maria Jansen', 'persoon').uitkomst, 'GEEN_TREFFER_IN_LIJST'));
  it('the type "voertuig" is accepted in a signed list', () => {
    const d = tmpRoot();
    writeSnapshot(d, 'eu-fsf', lijst('voertuig'), K.priv);
    const r = runCheck({ claims: [{ id: 'a', type: 'entity', value: 'Nothing Like It' }], snapshotDir: d, pubKeyPem: K.pub, now: NOW, required: { entity: ['eu-fsf'], country: ['cahras'] } });
    assert.equal(r.bronnen[0].bruikbaar, true);
    cleanup(d);
  });
  it('cleanup', () => cleanup(dir));
});

describe('hostile and cut-off files', () => {
  const kloktijd = (f) => { const t0 = Date.now(); f(); return Date.now() - t0; };
  it('blokken and zonder are linear: 300,000 opening tags that are never closed take well under a few seconds', () => {
    const vijandig = '<aka>x'.repeat(300000);
    assert.ok(kloktijd(() => assert.deepEqual([...blokken(vijandig, 'aka')], [])) < 3000);
    assert.ok(kloktijd(() => assert.equal(zonder(vijandig, ['aka', 'akaList']).length, vijandig.length)) < 3000);
  });
  it('the parsers stay fast on a hostile record (OFAC entry, UN individual, UK designation with endless unclosed blocks)', () => {
    const rommel = '<aka>x'.repeat(120000);
    assert.ok(kloktijd(() => parseOfacSdn(ofac(sdn(`<uid>1</uid><lastName>X</lastName>${rommel}`)))) < 3000);
    assert.ok(kloktijd(() => parseUnSc(un(unPerson(`<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER>${'<NATIONALITY>x'.repeat(120000)}`)))) < 3000);
    assert.ok(kloktijd(() => parseUkSanctions(uk(desig('A1', `<Names>${'<Name>x'.repeat(120000)}</Names>`)))) < 3000);
  });
  it('zonder takes out every block of each tag, keeps what is around them, and leaves a block that is never closed', () => {
    assert.equal(zonder('a<b>1</b>c<b>2</b>d<e>3</e>f', ['b']), 'acd<e>3</e>f');
    assert.equal(zonder('a<b>1</b>c<e>3</e>f', ['b', 'e']), 'acf');
    assert.equal(zonder('a<b>1</b>c<b>2', ['b']), 'ac<b>2');
    assert.equal(zonder('a<bx>1</bx>', ['b']), 'a<bx>1</bx>');
    assert.equal(zonder('plain', ['b']), 'plain');
  });
  it('a file cut off between two records, with the closing tag of the whole missing, is refused by every parser', () => {
    assert.throws(() => parseUnSc(un(unPerson('<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER>')).replace('</CONSOLIDATED_LIST>', '')), /afgekapt/);
    assert.throws(() => parseOfacSdn(ofac(sdn('<uid>1</uid><lastName>X</lastName>')).replace('</sdnList>', '')), /afgekapt/);
    assert.throws(() => parseUkSanctions(uk(desig('A1', '<Names></Names>')).replace('</Designations>', '')), /afgekapt/);
    assert.throws(() => parseEuFsf('<export generationDate="2026-10-23T17:05:43.888+02:00"><sanctionEntity logicalId="1"><nameAlias wholeName="A"/></sanctionEntity>'), /afgekapt/);
  });
  it('a file that ends on its closing tag, with white space after it, is fine', () => {
    assert.equal(parseUnSc(un(unPerson('<FIRST_NAME>X</FIRST_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER>')) + '\r\n  \n').entries.length, 1);
    assert.equal(parseEuFsf('<export generationDate="2026-10-23T17:05:43.888+02:00"><sanctionEntity logicalId="1"><nameAlias wholeName="A"/></sanctionEntity></export>\n').entries.length, 1);
  });
  it('eindeControle looks at the end only, and a closing tag in the middle does not count', () => {
    assert.throws(() => eindeControle('</root>' + 'x'.repeat(300), '</root>'), /afgekapt/);
    assert.doesNotThrow(() => eindeControle('x'.repeat(300) + '</root>', '</root>'));
    assert.throws(() => eindeControle('</root>' + 'x'.repeat(50), '</root>'), /afgekapt/, 'the closing tag must be the LAST thing, not just near the end');
  });
});
