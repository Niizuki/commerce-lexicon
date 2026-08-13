# Schema Evolution

Phase 6 of the validator asserts that this schema evolves additively. Nothing until now said what *additive* means, which left the claim resting on the judgement of whoever happened to be editing. This document is the missing half: what may change, what may not, and what a change costs.

It is written for two audiences with opposite problems. A contributor needs to know whether the field they want to add is free or expensive. An implementer needs to know what they must tolerate so that free changes actually stay free.

---

## What the reference validator tolerates

Four behaviours of `@atproto/lexicon` make additive evolution possible. They are worth stating exactly, because every rule below is downstream of them, and because three of the four are silent — they are equally the reason a mistake goes unnoticed.

| Behaviour | Verified | Consequence |
|---|---|---|
| Unknown object properties are **accepted and preserved** | A record with `totallyMadeUpField` validates, and the value survives conversion | New optional fields are free — and so is a typo |
| Unknown union members are **accepted** | A `purchase` with an undeclared `$type` validates | New mechanisms and targets are free |
| Values outside `knownValues` are **accepted** | `condition: "wellLoved"` validates | New vocabulary entries are free |
| `default` is **not applied** | A record with no `structure` validates and comes back with `structure` still `undefined` | Defaults are the reader's job, not the wire's |

All five union sites in this schema — `listing.purchase`, `listing.details`, `listing.labels`, `promotion.targets[]`, `promotion.mechanism` — are open; none declares `closed: true`. That is deliberate and should stay that way. Closing a union converts every future member from an additive change into a breaking one.

The first three tolerances are why this repo carries checks the reference validator does not. Phase 3 rejects fixtures with undeclared properties, because otherwise a misspelled field name is indistinguishable from a new one. INV10 rejects *withdrawn* properties, because otherwise a field that moved to another record can quietly move back. Both exist to recover the errors that tolerance throws away.

---

## The change taxonomy

### Free

These require no coordination. Existing records stay valid; existing readers keep working.

| Change | Precedent in this schema |
|---|---|
| Add an optional property | `shortDescription`, `banner`, `lowStockThreshold`, `priceIncludesTax` |
| Add a union member | `#collectionTarget` on `promotion.targets` |
| Add a `knownValues` entry | `backorder` on `inventory.availability` |
| Add a whole record type | `inventory`, `promotion`, `policy`, `fulfillmentProfile`, `collection`, `license` |
| Add a def to `defs` | `groupedItem`, `regionScope` |
| Make a required property optional | `variantProperty.value` |
| Widen a constraint (raise `maxLength`, lower `minimum`) | — |

Adding a record type is the cheapest change of all, and is why the boundary work in [boundaries.md](boundaries.md) is an investment rather than an overhead: once a concept has its own record, everything it grows into is free.

### Two-part

Each of these is an addition and a removal wearing one name. The addition is free; **the removal is the breaking half**, and should be reasoned about on its own. Follow *Withdrawing a field* below for that half.

| Change | Precedent |
|---|---|
| Split one field into several | `type` → `structure` + `fulfillmentKind` + `purchase` |
| Replace loose fields with a union | `externalUrl` / `checkoutUrl` → `purchase` |
| Replace a scalar with an array | `fileFormat` → `fileFormats` |
| Extract fields into a new record | `availability` / `quantity` / `slotsAvailable` → `inventory`; sale fields → `promotion` |
| Replace free text with a scheme reference | `subcategory` → `classifications` |
| Hoist a shape into `defs` | `fulfillmentProfile#coverage` → `defs#regionScope` |

The honest framing is that a two-part change has a window during which both shapes exist in the wild. This schema is pre-adoption, so that window has been zero and every such change has been done in one commit. **Once anyone is publishing records, that stops being true**, and the removal half should lag the addition by at least one release — long enough for writers to move.

### Breaking

Avoid. If unavoidable, it is a namespace decision, not a field decision.

- **Adding a required property.** Every existing record becomes invalid. This is why `title`, `category`, and `fulfillmentKind` are schema-optional on `listing` and enforced by INV2 instead — Lexicon cannot say "required unless `partOf` is set", and the conditional requirement was worth more than the schema-level guarantee.
- **Narrowing a constraint.** Lowering a `maxLength`, raising a `minimum`, tightening a `format`.
- **Changing a property's type.** Including scalar → array, which is why that is listed as two-part: the new field gets a new name.
- **Removing or renaming a def other lexicons `ref`.** Phase 2 catches this within the repo. It cannot catch it in anyone else's.
- **Changing an NSID.** See below.

---

## Withdrawing a field

Because unknown properties are silently accepted, deleting a field from a lexicon does *not* stop anyone writing it, and does not make a record carrying it invalid. A deletion is therefore not self-enforcing, and the schema needs a place to remember what went and why.

That place is `WITHDRAWN_FIELDS` in `scripts/checks/invariants.js`, enforced by INV10. The procedure:

1. **Remove it from the lexicon.**
2. **Add it to `WITHDRAWN_FIELDS`** under its record's NSID, with a reason phrased for whoever reads the validation failure — `'moved to the inventory record'`, not `'deprecated'`. Nested fields take a dotted path (`details.fileFormat`).
3. **Record the reasoning in [boundaries.md](boundaries.md).** The map says *what*; the doc says *why*, and the why is what stops the field being re-proposed in a year.
4. **Update any fixture that used it**, including the invalid-corpus records — a record built to violate one invariant should not start violating two.

The reader's obligation is the mirror image: **ignore a withdrawn field, do not honour it.** Every withdrawal in this schema happened because the value acquired an authoritative home elsewhere. A consumer that reads `listing.availability` because it is present is reading stale stock in preference to the `inventory` record, which is worse than not reading it at all.

---

## The forward-compatibility obligation

`test/forward-compat/` proves the tolerances above by holding records that use values the schema does not declare. The trap is structural: **the moment you declare one of those values, the fixture stops testing anything, and it keeps passing.** Phase 6 sees only that the record validates, which is exactly what it asked for.

This has happened twice — `backorder`, then `#collectionTarget`. Both were caught by reading the brief that predicted them, not by the build.

So: **before declaring any new `knownValues` entry or union member, grep `test/forward-compat/` for it.** If a fixture uses it, swap that fixture onto a value still undeclared, in the same commit, and update the manifest's reason string. Currently in use, and therefore currently load-bearing: `made_to_order` (availability), `#taxonomyTarget` (promotion target), `#percentageDiscount` (promotion mechanism), `vintage_synths` (category slug), `rental` (fulfillment kind). Declaring any one of those five without swapping its fixture silently costs you the test.

---

## Defaults are a reader concern

`listingStructure` defaults to `simple` and `groupedItem.quantity` to `1`, and the validator applies neither. A record that omits `structure` comes back with `structure` undefined, not `"simple"`.

A `default` in a Lexicon is therefore documentation of what absence *means*, not a value anything writes. Consumers must apply it themselves — which is why `invariants.js` reads `entry.record.structure ?? 'simple'` rather than trusting the field. Changing a default is a change to the meaning of every record that omits the field, so it is closer to breaking than to free.

---

## What implementing apps must tolerate

The tolerances at the top are worth nothing if applications do not honour them. An app that rejects an unknown union member makes adding a promotion mechanism a breaking change no matter what the schema permits. These are the consumer half of the contract:

1. **An unknown union member**: skip that member, keep the record. A promotion with a mechanism you do not understand is a promotion you cannot display — not a corrupt record.
2. **A value outside `knownValues`**: treat it as opaque and pass it through. Do not reject, and do not coerce it to a known value.
3. **An unknown property**: ignore it.
4. **A withdrawn property**: ignore it, per above.
5. **An absent inheritable field on a variant**: resolve it from `partOf` before display or indexing (INV3). Absence is not emptiness.
6. **A reference that does not resolve**: degrade, do not fail. Records arrive out of order and repos go offline; a listing whose `license` has not been fetched yet is still a listing.
7. **Derived values**: compute them. Group availability, price ranges, active promotion sets, and review aggregates are never on the wire, by design (INV10).

---

## Namespace migration

One change ahead is breaking by construction: `app.temp.commerce.*` exists to migrate to `lexicon-community` once the schema stabilises.

There is no version negotiation in Lexicon and no version field on these records. An NSID change rewrites every `$type` and every `at-uri` collection segment, so records under the old namespace and the new one are unrelated as far as any validator is concerned. Nothing in this document makes that cheaper.

That is precisely why the namespace is `app.temp.*` today. The migration is affordable while nobody depends on it and expensive afterwards, so the ordering that matters is: **settle the shape first, migrate once, adopt after.** A `catalog` or `attestation` domain arriving before the migration would multiply the rewrite rather than add to it.

If records do exist at migration time, the only honest options are a one-time rewrite by each repo owner, or dual publication for a window. Both are real work. Neither is a schema feature.

---

## Checklist for a schema change

1. Classify it: free, two-part, or breaking. If breaking, stop and reconsider the shape.
2. If it declares a `knownValues` entry or union member, grep `test/forward-compat/` and swap any fixture that used it.
3. If it withdraws a field, follow *Withdrawing a field* — lexicon, `WITHDRAWN_FIELDS`, `boundaries.md`, fixtures.
4. Exercise every new def with a fixture, and register it in the relevant `manifest.json`. Phase 4 fails on an uncovered def; phase 3 fails on an unaddressed fixture.
5. Pin every new constraint with a record in `test/invalid/` and its expected message substring. A constraint no test exercises is one that will be relaxed by accident.
6. Implement any new invariant in `scripts/checks/invariants.js`, add a record to `test/invalid-corpus/`, and add its code to `expectViolations` — once per independent branch of the check.
7. Update the README records table, the invariant list, and `boundaries.md`. Documentation moves with the schema; it is part of the change, not follow-up work.
8. `npm run validate`.
