# Validation

```bash
npm run validate
```

`@atproto/lexicon` is the reference implementation of Lexicon validation, so it stays the authority on whether a record is well-formed — the question that matters for a schema repo is "would a real PDS accept this?", and only the reference validator answers it. Everything here is a layer of checks *on top of* it, covering what it does not do.

Eight phases, all in `scripts/`. Any failure exits non-zero.

| Phase | Checks | Catches |
|---|---|---|
| 1. Schema registration | Every lexicon parses and registers into one `Lexicons` instance | Malformed lexicon docs |
| 2. Ref integrity | Every `ref` / `union` member resolves to a def that exists and is referenceable | Typo'd or stale refs — see below |
| 3. Valid fixtures | Each fixture validates, and carries no property the schema does not declare | Broken records; misspelled or withdrawn field names |
| 4. Schema coverage | Every def in `app.temp.commerce.*` is exercised by some fixture | Schema that has quietly stopped being tested |
| 5. Invalid fixtures | Each record in `test/invalid/` is rejected, *with the expected message* | A schema that has stopped constraining anything |
| 6. Forward compatibility | Each record in `test/forward-compat/` is accepted despite using undeclared extensions | An accidental tightening that breaks additive evolution |
| 7. App-level invariants | The thirteen cross-record rules from the README, over the whole fixture corpus | Inconsistent records that are individually valid |
| 8. Invariant self-test | The invariant checks, run over a corpus built to violate each one, once per independent branch | An invariant check that silently stopped working |

## Why phase 6 exists

The boundary design rests on a claim: unknown category slugs stay protocol-valid, and new promotion mechanisms and targets arrive as additive union members rather than as breaking changes. That claim is what makes it safe to ship a small core. It is verified, not assumed — phase 6 holds records with an unregistered category, an unknown `fulfillmentKind`, a `#percentageDiscount` mechanism, a `#taxonomyTarget`, and a `made_to_order` availability, and requires all of them to validate.

Phase 3 rejects undeclared union members, because our *own* fixtures should only use declared ones. Phase 6 relaxes exactly that rule, since tolerating undeclared members is what it exists to test. Extension records use a separate coverage set, so they can never make phase 4 look satisfied.

### The maintenance trap in phase 6

Each of these fixtures has to keep using a value the schema does **not** declare. When a round of work declares one, the fixture still validates — it just stops testing anything, because the extension it was built around is no longer an extension. Phase 6 cannot detect this: all it sees is that the record validates, which is exactly what it asked for.

This has happened twice. `unknown-availability.json` demonstrated `backorder` until the catalogue-completeness round declared it, and moved to `made_to_order` in the same commit. `unknown-promotion-target.json` demonstrated `#collectionTarget` until the `collection` record landed, and moved to `#taxonomyTarget`. Whoever declares a value one of these fixtures depends on owns that swap — and it is worth noticing that in both cases the fixture would have gone on passing, silently proving nothing, for as long as nobody looked.

## Why phase 2 exists

`Lexicons.add()` does not verify refs. It calls `resolveRefUris`, which only rewrites ref strings into absolute URIs; the target def is looked up lazily at validation time. A ref to a def that does not exist therefore registers cleanly, and only surfaces if some fixture happens to exercise that branch. Renaming a def and missing one reference site is silent until a user hits it.

Phase 2 walks every ref in every lexicon and resolves it eagerly. Phase 4 is the other half: it stops the corpus from drifting until no fixture reaches a given branch in the first place.

## Why fixtures have a manifest

`test/fixtures/manifest.json` maps each file to an AT URI. Fixtures stay byte-exact records — a fixture is also documentation of what a valid record looks like, so nothing extra may be smuggled inside it — and the manifest supplies the address that a record has in a repo but not in a file.

With addresses, the corpus becomes a small federation: `did:plc:seller` owns the shop, listings, group, inventory, promotions, policy, and fulfillment profile; `did:plc:buyer` owns the reviews, because reviews live in the reviewer's repo. That is what makes the cross-record invariants checkable at all — reference resolution, promotion authority, inventory uniqueness, and variant inheritance are all statements about records *in relation to each other*.

The validator also asserts the manifest and directory agree in both directions, so a fixture cannot be added without an address and an entry cannot outlive its file.

## Invariant codes

Codes are stable and map 1:1 to the numbered list in the README. `scripts/checks/invariants.js` is the implementation.

| Code | Rule |
|---|---|
| INV1 | `structure: "variant"` iff `partOf` is set |
| INV2 | A listing with no `partOf` must carry `title`, `category`, `fulfillmentKind` |
| INV3 | A variant must be able to resolve its inherited fields from its group |
| INV4 | `details` must match the resolved `fulfillmentKind` |
| INV5 | `variantProperties` must use axes and values the group declares; a value-less property spans its axis, so only the axis is checked |
| INV6 | AT URIs must point at the right collection, and at a record that exists |
| INV7 | At most one inventory record per listing |
| INV8 | A promotion only binds records published by the DID that issued it |
| INV9 | A policy must carry `content` or `url` |
| INV10 | Extracted and derived fields must not reappear on a record |
| INV11 | `structure: "grouped"` iff `groupedItems` is present, and a grouped listing must not list itself |
| INV12 | `productGroup.defaultVariant` must be a listing whose `partOf` is that group |
| INV13 | A license must carry `content`, `url`, or `identifier` |

INV10 is the guard against regression to the pre-boundary shape. It matters because the reference validator *ignores* unknown properties: writing `availability` back onto a listing is silently valid Lexicon, and only a check like this notices that stock state has crept back out of the inventory record. Its field map takes dotted paths, so a withdrawn field nested inside a union member — `details.fileFormat`, replaced by `fileFormats` — is caught as well as a top-level one.

INV11 and INV12 catch the errors that render as a *confusing page* rather than an obvious failure: a bundle that never says what it bundles, and a product page opening on a variant belonging to some other product.

Codes may appear more than once in `expectViolations` where a check has independent branches worth pinning separately — INV10 for the top-level and nested cases, INV11 for the two ways a grouped listing can be malformed.

## Fixtures and blobs

Fixtures are converted with `jsonToLex` before validation, exactly as records arriving over the wire are. This is not cosmetic: the blob validator requires a `BlobRef` instance, so before this conversion existed no fixture could exercise an `images` field at all — a blob written as plain JSON was rejected outright, and blob-carrying records were simply untestable.

## Adding to the corpus

- **A new record fixture**: add the file to `test/fixtures/` and an entry to its `manifest.json`. Phases 3 and 7 pick it up automatically.
- **A new schema def**: add or extend a fixture that exercises it, or phase 4 fails.
- **A new constraint you want proven**: add a record to `test/invalid/` plus the expected message substring in its manifest. Matching on the message, not merely on failure, keeps the fixture from passing later for an unrelated reason.
- **A new app-level invariant**: implement it in `scripts/checks/invariants.js`, document it in the README list and the table above, then add a record to `test/invalid-corpus/` and its code to `expectViolations`. Phase 8 fails if a check never fires, and equally if one fires on a record that was supposed to be clean.

For what a change is *allowed* to be in the first place — free, two-part, or breaking — and for the checklist that covers all of the above, see [evolution.md](evolution.md).

## What is not checked

- **Record key conventions.** Inventory records should reuse their subject listing's rkey (idempotent stock writes), but this is a documented recommendation, not a machine-checked rule.
- **`knownValues`.** They are advisory by design: unknown slugs stay protocol-valid so that adding a category is not a breaking change. Nothing warns about a value outside the set.
- **Semantic sanity.** That a price is plausible, an image matches the title, or a specification is true of the product.
