// The lists the feeder can fetch: where from, which parser, how large a good list is at least, and under what terms it may be used.
// The ids are the same as ENTITY_SOURCES in src/check.mjs (a test keeps them equal). Everything here is fixed in code on purpose:
// the feeder takes no address from the command line, so a changed argument can never point it at another host.
import { parseEuFsf } from '../src/adapters/eu-fsf.mjs';
import { parseOfacSdn } from '../src/adapters/ofac-sdn.mjs';
import { parseUkSanctions } from '../src/adapters/uk-sanctions.mjs';
import { parseUnSc } from '../src/adapters/un-sc.mjs';

export const BRONNEN = {
  'eu-fsf': {
    url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
    hosts: ['webgate.ec.europa.eu'],
    pathPrefix: '/fsd/fsf/public/files/',
    floor: 3000,
    parse: parseEuFsf,
    license: 'EU Financial Sanctions Files, DG FISMA. Reuse under Commission Decision 2011/833/EU (OJ L 330, 14.12.2011): source acknowledged, meaning not distorted, no liability of the Commission. Terms read 2026-11-07 from the original text; consolidated version and any notice on the FSF site itself not checked. Only the Official Journal is authentic.',
  },
  'uk-sanctions': {
    url: 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml',
    hosts: ['sanctionslist.fcdo.gov.uk'],
    pathPrefix: '/docs/',
    floor: 3000,
    parse: parseUkSanctions,
    license: 'UK Sanctions List, Foreign, Commonwealth and Development Office. Published under the Open Government Licence v3.0 ("All content is available under the Open Government Licence v3.0, except where otherwise stated", gov.uk page read 2026-11-08). Contains public sector information licensed under the Open Government Licence v3.0. Not checked: whether any single entry carries other terms. The official list is the one on the UK government site.',
  },
  'ofac-sdn': {
    url: 'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/sdn.xml',
    // The service hands out a short-lived link on its own storage; that storage host and path are the only ones accepted.
    hosts: ['wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com'],
    pathPrefix: '/Published/',
    floor: 10000,
    parse: parseOfacSdn,
    license: 'Specially Designated Nationals and Blocked Persons List, US Treasury OFAC. Published by a US federal agency for public use; works of the US federal government carry no US copyright (17 U.S.C. 105, our reading, not a statement by OFAC). No usage terms were found on the OFAC Sanctions List Service pages read on 2026-11-08. The legal text of the designations is in the Federal Register; this is a copy for comparison only.',
  },
  // Not part of the default set (see ENTITY_SOURCES): the UN terms are not clear for this use.
  'un-sc': {
    url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    hosts: ['unsolprodfiles.blob.core.windows.net'],
    pathPrefix: '/publiclegacyxmlfiles/',
    floor: 700,
    parse: parseUnSc,
    license: 'United Nations Security Council Consolidated List. The general UN website terms (un.org/en/about-us/terms-of-use, read 2026-11-08) allow downloading and copying for personal, non-commercial use without any right to resell or redistribute, and do not allow adapting or compiling derivative works; they add that more specific restrictions may apply to specific material. The consolidated list pages read carry no more specific terms (not checked in full). No permission from the UN has been asked or given. Use of this source is the operator\'s own responsibility.',
  },
};
