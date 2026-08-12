import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Lexicons, jsonToLex } from '@atproto/lexicon';
import { indexDocs, checkRefIntegrity, walkRecord, checkCoverage } from './checks/schema.js';
import { checkInvariants, parseAtUri } from './checks/invariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const lexiconDir = path.join(root, 'lexicons');
const fixtureDir = path.join(root, 'test', 'fixtures');
const invalidDir = path.join(root, 'test', 'invalid');
const invalidCorpusDir = path.join(root, 'test', 'invalid-corpus');
const forwardDir = path.join(root, 'test', 'forward-compat');

let errors = 0;
const fail = (message, detail) => {
  console.error(`  ❌ ${message}${detail ? `\n     ${detail}` : ''}`);
  errors++;
};
const ok = (message) => console.log(`  ✅ ${message}`);
const byCode = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const phase = (title) => console.log(`\n--- ${title} ---\n`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function walkDir(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) results = results.concat(walkDir(filePath));
    else if (file.endsWith('.json')) results.push(filePath);
  }
  return results;
}

/** Load a directory of record fixtures plus its manifest, into a corpus of addressed records. */
function loadCorpus(dir, manifest) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
  const corpus = [];
  for (const file of files) {
    const uri = manifest[file];
    if (!uri) {
      fail(`${file} has no manifest entry`, 'every fixture needs an AT URI so cross-record checks can address it');
      continue;
    }
    const record = readJson(path.join(dir, file));
    const parsed = parseAtUri(uri);
    const nsid = String(record.$type ?? '').split('#')[0];
    if (!record.$type) {
      fail(`${file}: missing $type`);
      continue;
    }
    if (!parsed) {
      fail(`${file}: manifest URI is not a well-formed AT URI (${uri})`);
      continue;
    }
    if (parsed.collection !== nsid) {
      fail(`${file}: manifest URI collection is ${parsed.collection} but $type is ${nsid}`);
      continue;
    }
    corpus.push({ file, uri, ...parsed, nsid, record });
  }
  for (const file of Object.keys(manifest)) {
    if (!files.includes(file)) fail(`manifest lists ${file}, which does not exist in ${path.basename(dir)}/`);
  }
  const seen = new Set();
  for (const entry of corpus) {
    if (seen.has(entry.uri)) fail(`duplicate AT URI in manifest: ${entry.uri}`);
    seen.add(entry.uri);
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// Phase 1 — register every lexicon into one instance (structural validity).
// ---------------------------------------------------------------------------
phase('Phase 1: schema registration');
const lexicons = new Lexicons();
const lexiconFiles = walkDir(lexiconDir);
const docs = [];
for (const file of lexiconFiles) {
  const rel = path.relative(lexiconDir, file);
  try {
    docs.push(readJson(file)); // separate copy: Lexicons.add() rewrites refs in place
    lexicons.add(readJson(file));
    ok(rel);
  } catch (e) {
    fail(rel, e.message);
  }
}
const index = indexDocs(docs);

// ---------------------------------------------------------------------------
// Phase 2 — static ref integrity. Lexicons.add() resolves refs lazily, so a ref
// to a nonexistent def is otherwise invisible until a fixture exercises it.
// ---------------------------------------------------------------------------
phase('Phase 2: ref integrity');
const refErrors = checkRefIntegrity(index);
for (const message of refErrors) fail(message);
if (!refErrors.length) ok(`all refs resolve across ${index.size} lexicons`);

// ---------------------------------------------------------------------------
// Phase 3 — valid fixtures must validate, and must not carry undeclared fields.
// Fixtures are converted with jsonToLex first, exactly as records arriving over
// the wire are, so blob and cid-link fields are validated rather than rejected.
// ---------------------------------------------------------------------------
phase('Phase 3: valid fixtures');
const fixtureManifest = fs.existsSync(path.join(fixtureDir, 'manifest.json'))
  ? readJson(path.join(fixtureDir, 'manifest.json')).records ?? {}
  : (fail('test/fixtures/manifest.json is missing'), {});
const corpus = fs.existsSync(fixtureDir)
  ? loadCorpus(fixtureDir, fixtureManifest)
  : (fail('no test/fixtures/ directory — record validation cannot run'), []);

const touched = new Set();
let validated = 0;
for (const entry of corpus) {
  const problems = [];
  try {
    lexicons.assertValidRecord(entry.nsid, jsonToLex(entry.record));
  } catch (e) {
    problems.push(e.message);
  }
  problems.push(...walkRecord(index, entry.record, touched).errors);
  if (problems.length) fail(entry.file, problems.join('\n     '));
  else {
    ok(`${entry.file} (${entry.uri})`);
    validated++;
  }
}
if (validated === 0) fail('no records validated — fixtures are required');

// ---------------------------------------------------------------------------
// Phase 4 — every def in our own lexicons must be exercised by some fixture.
// ---------------------------------------------------------------------------
phase('Phase 4: schema coverage');
const uncovered = checkCoverage(index, touched);
for (const uri of uncovered) fail(`${uri} is never exercised by a fixture`);
if (!uncovered.length) ok(`all project defs exercised (${touched.size} defs reached)`);

// ---------------------------------------------------------------------------
// Phase 5 — records that must be rejected. Without this, nothing proves the
// schema constrains anything at all.
// ---------------------------------------------------------------------------
phase('Phase 5: invalid fixtures (must be rejected)');
const expectErrors = fs.existsSync(path.join(invalidDir, 'manifest.json'))
  ? readJson(path.join(invalidDir, 'manifest.json')).expectErrors ?? {}
  : (fail('test/invalid/manifest.json is missing'), {});
const invalidFiles = fs.existsSync(invalidDir)
  ? fs.readdirSync(invalidDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  : [];
if (!invalidFiles.length) fail('no invalid fixtures — rejection is unproven');
for (const file of invalidFiles) {
  const expected = expectErrors[file];
  if (!expected) {
    fail(`${file} has no expected-error entry in test/invalid/manifest.json`);
    continue;
  }
  const record = readJson(path.join(invalidDir, file));
  let message = null;
  try {
    lexicons.assertValidRecord(String(record.$type ?? '').split('#')[0], jsonToLex(record));
  } catch (e) {
    message = e.message;
  }
  if (message === null) fail(`${file} was expected to be rejected, but validated cleanly`);
  else if (!message.includes(expected)) fail(`${file} was rejected for the wrong reason`, `expected to contain: ${expected}\n     actual:                ${message}`);
  else ok(`${file} rejected: ${message}`);
}
for (const file of Object.keys(expectErrors)) {
  if (!invalidFiles.includes(file)) fail(`manifest lists ${file}, which does not exist in invalid/`);
}

// ---------------------------------------------------------------------------
// Phase 6 — forward compatibility. Records using extensions this schema does not
// declare must still validate: that tolerance is what lets the boundaries evolve
// without a breaking change, and it is a claim worth testing rather than asserting.
// ---------------------------------------------------------------------------
phase('Phase 6: forward compatibility (must be accepted)');
const expectAccepted = fs.existsSync(path.join(forwardDir, 'manifest.json'))
  ? readJson(path.join(forwardDir, 'manifest.json')).expectAccepted ?? {}
  : (fail('test/forward-compat/manifest.json is missing'), {});
const forwardFiles = fs.existsSync(forwardDir)
  ? fs.readdirSync(forwardDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  : [];
if (!forwardFiles.length) fail('no forward-compatibility fixtures — extensibility is unproven');
for (const file of forwardFiles) {
  const why = expectAccepted[file];
  if (!why) {
    fail(`${file} has no entry in test/forward-compat/manifest.json`);
    continue;
  }
  const record = readJson(path.join(forwardDir, file));
  const problems = [];
  try {
    lexicons.assertValidRecord(String(record.$type ?? '').split('#')[0], jsonToLex(record));
  } catch (e) {
    problems.push(e.message);
  }
  // A separate touched set: an extension record must never satisfy phase 4 coverage.
  problems.push(...walkRecord(index, record, new Set(), { allowUndeclaredUnionMembers: true }).errors);
  if (problems.length) fail(`${file} was expected to be accepted (${why})`, problems.join('\n     '));
  else ok(`${file} accepted: ${why}`);
}
for (const file of Object.keys(expectAccepted)) {
  if (!forwardFiles.includes(file)) fail(`manifest lists ${file}, which does not exist in forward-compat/`);
}

// ---------------------------------------------------------------------------
// Phase 7 — app-level invariants across the whole fixture corpus.
// ---------------------------------------------------------------------------
phase('Phase 7: app-level invariants');
const violations = checkInvariants(corpus);
for (const v of violations) fail(`[${v.code}] ${v.file}`, v.message);
if (!violations.length) ok(`${corpus.length} records satisfy all invariants`);

// ---------------------------------------------------------------------------
// Phase 8 — the invariant checks themselves, run against a corpus built to
// violate each one exactly once. A checker nobody tests is a checker that
// silently stops checking.
// ---------------------------------------------------------------------------
phase('Phase 8: invariant self-test');
if (!fs.existsSync(path.join(invalidCorpusDir, 'manifest.json'))) {
  fail('test/invalid-corpus/manifest.json is missing');
} else {
  const spec = readJson(path.join(invalidCorpusDir, 'manifest.json'));
  const badCorpus = loadCorpus(invalidCorpusDir, spec.records ?? {});
  const found = checkInvariants(badCorpus).map((v) => v.code).sort(byCode);
  const expected = [...(spec.expectViolations ?? [])].sort(byCode);
  if (found.join(',') === expected.join(',')) {
    ok(`all ${expected.length} invariant checks fire: ${expected.join(', ')}`);
  } else {
    const missing = expected.filter((c) => !found.includes(c));
    const extra = found.filter((c) => !expected.includes(c));
    fail(
      'invariant self-test mismatch',
      [
        missing.length ? `never fired: ${missing.join(', ')}` : null,
        extra.length ? `fired unexpectedly: ${extra.join(', ')}` : null,
        `expected [${expected.join(', ')}] got [${found.join(', ')}]`,
      ].filter(Boolean).join('\n     '),
    );
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
console.log(`Lexicons:  ${lexiconFiles.length}`);
console.log(`Fixtures:  ${validated} valid, ${invalidFiles.length} rejected as expected, ${forwardFiles.length} extensions accepted`);
console.log(`Defs:      ${touched.size} exercised, ${uncovered.length} uncovered`);
console.log(`Invariants: ${violations.length} violations in the valid corpus`);
if (errors > 0) {
  console.log(`\n${errors} error(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
