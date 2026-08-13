# Catalogue Completeness — Implementation Brief

> IMPLEMENTED, except A2. §A1 (`fulfillmentProfile`), all eleven items of §B, and the
> §C1 decision have landed in the schema. §A2 (`collection`) was skipped, as this brief
> permits — it is the only item here no reviewer asked for. The §D seams remain unbuilt
> and their triggers unmet.
>
> See [boundaries.md](boundaries.md) §17 for what was built for each item, the reasoning,
> and what was deliberately left undone. This is now a record of intent, not an open work list.

## Status

This is a work brief, not a record of what exists. It specifies the next round of schema changes and the reasoning behind each one.

Its source is the review by auadix (Al, maintainer of Open Market) in [discussion #4862](https://github.com/bluesky-social/atproto/discussions/4862#discussioncomment-17901346), dated 2026-08-05. That review is field-level and concrete. The original architectural brief answered its *architectural* questions — pricing and promotions, inventory extraction, policies, taxonomy, specifications, the shipping/tax boundary — and those answers are already implemented and recorded in [boundaries.md](boundaries.md). What was never carried across is the field-level half of the review, which is what this brief covers.

The test the review applied is the one to keep applying:

> Could a real shop describe its full catalogue in this schema without losing anything?

Today the answer is no in thirteen specific places.

---

## The rule for where things go

Same rule as before, from [boundaries.md](boundaries.md) §13. A concept earns its own record when it changes on a different lifecycle, when several may apply at once, when it has a different author, when it may grow into a subsystem, when it is a relationship rather than an intrinsic property, or when embedding it would demand increasingly conditional fields.

The counterweight matters just as much: fragmenting everything makes the protocol unusable. A field that is small, intrinsic to one record, and stable belongs inline.

Applying both directions to this round:

- **Two new records** (§A). Both describe something with its own lifecycle and its own room to grow, and both are versioned independently of the listing.
- **Eleven sets of core fields** (§B). Each is intrinsic to the record it sits on, and extracting any of them would be fragmentation for its own sake. The justification is given per item, because "why is this *not* a separate record" is the question a reviewer will ask.
- **One decision to settle first** (§C), because it changes what the other work looks like.
- **Four named seams** (§D) that are deliberately not built, each with the condition that would trigger building it.

---

## Definition of done

The validator will not let these changes land half-finished, but it is worth knowing what it will demand. For every item below:

1. **A fixture exercises every new def.** Phase 4 fails on any def in `app.temp.commerce.*` that no fixture reaches. A new object def with no fixture is a build failure, not a warning.
2. **New fixtures are addressed.** Add the file *and* an entry in the relevant `manifest.json`. Phase 3 fails on an unaddressed fixture, and phase 7 needs the address to check cross-record rules.
3. **New constraints get a rejection fixture.** Add a record to `test/invalid/` with the expected message substring. A constraint no test exercises is a constraint that will be relaxed by accident.
4. **New invariants get a self-test record.** Implement in `scripts/checks/invariants.js`, add a record to `test/invalid-corpus/`, add the code to `expectViolations`. Phase 8 fails if a check never fires *and* if one fires on a record meant to be clean.
5. **Docs move with the schema.** The README records table, the invariant list, and [boundaries.md](boundaries.md) are part of the change, not follow-up work.

### One trap specific to this round

Two forward-compatibility fixtures currently prove extensibility using values this brief *declares*:

- `test/forward-compat/unknown-availability.json` uses `backorder` — declared by **B5**.
- `test/forward-compat/unknown-promotion-target.json` uses `#collectionTarget` — declared by **A2**.

Once declared, those fixtures still pass, but they stop testing anything: they assert that an unknown extension is accepted, and the extension is no longer unknown. Whoever implements B5 or A2 must swap the value for one that is still undeclared (`made_to_order`, `#taxonomyTarget`) in the same commit. Phase 6 cannot catch this — it only sees that the record validates.

---

## §A. New sub-schemas

### A1. `app.temp.commerce.fulfillmentProfile`

**Source**: review §15 asks for `handlingTime` and `shipsTo` on the shop record.

**Why not on the shop.** [boundaries.md](boundaries.md) §8 names shipping destinations, methods, pickup locations, routing, and service areas as belonging to a separate fulfillment system, and draws the line as: *a listing describes properties of the thing being offered; a fulfillment system describes how that thing can be delivered.* `shipsTo` is a delivery destination and `handlingTime` is a delivery promise. Putting them on the shop record would place the first two fields of a fulfillment system inside seller identity, and every subsequent field — pickup locations, per-class handling, regional cutoffs — would have to follow them there or live somewhere inconsistent.

It also fails the lifecycle test. Shipping coverage changes with carrier contracts and seasons; a shop's name and logo do not.

**Shape**:

```text
fulfillmentProfile
    subject      -> shop        (required)
    handlingTime { minDays, maxDays }?
    coverage     -> #coverage?
    createdAt / updatedAt

#coverage
    worldwide: boolean?
    countries: [ISO 3166-1 alpha-2]?
    excludedCountries: [ISO 3166-1 alpha-2]?
```

Record key `tid`. Several profiles per shop is the point — a seller ships to the EU in two days and worldwide in ten — so this is not a `self` record.

**Explicitly out of scope**, and worth stating in the record description so the boundary survives contact with contributors: rate tables, rate calculation, carrier selection, and label generation. Deferred item 12 in [boundaries.md](boundaries.md#15-implementation-priority). This record says *where* and *how soon*, never *how much*.

**Future members** (additive, no schema change to anything else): pickup locations, per-`shippingClass` handling times, cutoff times, service areas for `fulfillmentKind: service`.

**Which listings a profile applies to** is deliberately unanswered in v1: a profile applies to the whole shop. When per-class coverage is needed, add an optional `appliesTo` selector to this record rather than a pointer on every listing.

### A2. `app.temp.commerce.collection`

**Source**: our own open list, not the review. A `#collectionTarget` for promotions is already sketched, and `test/forward-compat/unknown-promotion-target.json` demonstrates one. There is nothing for it to point at.

Treat this as **optional for this round** — it is the only item here not requested by a reviewer. Build it when someone wants a seller-curated set; skip it otherwise and the rest of the brief is unaffected.

**Shape**:

```text
collection
    shopRef -> shop   (required)
    title             (required)
    description?
    images?
    items: [at-uri]   -> listings and/or productGroups
    createdAt / updatedAt
```

**Membership direction.** Items are listed on the collection, not declared by each listing. A collection is a curated list authored as a unit, and this keeps listings — the high-traffic records — untouched when a seller reorders a shop front. The cost is that adding one item rewrites the collection record; that is acceptable because collections are small and change rarely, which is the opposite of the inventory case that justified extracting stock.

When this lands, add `#collectionTarget` to `promotion.targets` and extend INV6 to check the collection collection.

---

## §B. Core fields

### B1. Grouped listings — `groupedItems` (review §18)

**Now**: `structure: "grouped"` is a declared value with no field to express what is grouped. This is the sharpest gap in the schema, and it is self-inflicted: the dimension was split out without giving one of its values a mechanism.

**Change**: add to `listing`:

```json
"groupedItems": [
  { "item": "at://did:plc:seller/app.temp.commerce.listing/kb01",
    "quantity": 1, "title": "Custom Mechanical Keyboard" }
]
```

`defs#groupedItem` = `{ item (at-uri, required), quantity (int, min 1), title (string) }`.

**Why inline rather than a `bundle` record.** Composition is authored by the bundle itself and is meaningless without it, so it fails the "different author" and "multiple instances" tests. It is also already split correctly along the axis that matters: the *composition* is here, and the *discount* is a promotion mechanism (`BundleDiscount` is named as a future member in [boundaries.md](boundaries.md) §3). Extracting composition as well would leave a bundle record whose only content is a list.

`title` is denormalized deliberately, on the same reasoning as the review variant snapshot: the group still renders when an item is deleted or its server is unreachable.

**Do not** add per-item discount overrides. The review's argument holds — two apps computing a total from prices in other records, possibly stale, can disagree and both be correct. The grouped listing publishes its own price.

**Invariants**: extend INV6 (`groupedItems[].item` → `listing`, must resolve); add a check that a grouped listing does not include itself, and that `structure` is `grouped` iff `groupedItems` is present. Same-DID membership is recommended — decide whether to enforce it, since cross-seller bundles are not obviously wrong.

### B2. Listing location (review §13)

**Now**: only `shop` carries a location. A seller with one shop cannot say the sofa is pickup-only in Porto while everything else ships.

**Change**: optional `location` on `listing`, `defs#location`. When absent, fall back to the shop's location. Document the fallback in the same place the group-inheritance rule is documented — it is the same kind of rule and consumers will look for it there.

**Why not the fulfillment profile**: this is *where the item is*, an intrinsic fact, not a delivery method. Local pickup as a method belongs to A1.

### B3. Tax-inclusive pricing, and the minor-units trap (review §1)

**Now**: nothing says whether the price includes tax. A German seller quoting VAT-inclusive `2500 EUR` and a US seller quoting tax-exclusive `2500 EUR` write the identical record, and a buyer comparing them is comparing different numbers. A single shop settles this in its own configuration; a federated marketplace has no shared configuration, so the record must carry it.

**Change**: add `priceIncludesTax` (boolean) to `defs#taxInfo`.

**Why on `taxInfo` and not on `defs#price`**: `defs#price` is reused for promotion sale prices, and later for shipping costs and minimum spends. Putting the flag there forces every price everywhere to answer a question only an offer price has, and invites a promotion whose sale price contradicts its listing.

**Why not a shop-level default**: a default plus per-listing override is inheritance, and inheritance needs an authoritative source. The shop is not authoritative over a listing's tax treatment — the item's tax category can differ. One authoritative field on the offer is worth more than a default that silently applies to records that never considered it.

**Also**: amend `defs#price.amount`'s description. "Minor currency units (e.g. cents)" invites "divide by 100", which is wrong for JPY (no minor unit) and KWD (three digits). Say the exponent comes from ISO 4217 per currency, and name yen and dinar as the cases that break naive code. These bugs are silent and they corrupt data.

### B4. Digital terms of sale (review §14)

**Now**: `#digitalDetails` has `fileFormat` (single string) and `deliveryMethod`, both free text.

**Change**: `fileFormats` as an **array** (an asset pack is PNG and SVG and AI), plus `fileSize` (integer, bytes), `downloadLimit` (integer, `-1` = unlimited), `downloadExpiryDays` (integer, `-1` = never).

Keep `fileFormat` out once `fileFormats` exists; the singular becomes a withdrawn field in INV10.

**Do not** add a file URL. The record is public; publishing the URL gives the product away.

These are terms the buyer needs *before* buying, which is why they sit on the listing rather than in a transaction system.

### B5. Backorder and low stock (review §10)

**Now**: `inventory.availability` has `pre_order` but no `backorder`. They are different states: pre-order means not released yet and shipping on a known date; backorder means out of stock, still orderable, shipping when restocked. schema.org separates them too.

**Change**: add `backorder` to the `knownValues`, and add optional `lowStockThreshold` (integer) to `inventory` — it is what drives "only 2 left" messages, and it belongs with the quantity it qualifies.

**Remember the forward-compat swap** described under *Definition of done*.

### B6. Variant properties without a value (review §5)

**Now**: `defs#variantProperty` requires both `axis` and `value`, so "Red, any size, £20" alongside "Blue, XL, £25" cannot be written.

**Change**: make `value` optional. Absent means *any value on this axis*.

**Invariant**: INV5 must skip the value-membership check when `value` is absent, while still checking that the axis is declared. Add a self-test record, or this relaxation will quietly disable half of INV5.

### B7. `defaultVariant` (review §8)

**Change**: optional `defaultVariant` (at-uri) on `productGroup`, naming which variant a product page opens on.

**Invariants**: extend INV6 (must point at a `listing` that exists); add a check that the target's `partOf` is this group. A default variant belonging to another group is the kind of error that renders as a confusing page rather than an obvious failure.

### B8. Display and control fields (review §4)

Add to `listing`:

- **`shortDescription`** — for cards and feeds. Without it every app truncates the long description differently and all of them do it badly.
- **`catalogVisibility`** (`visible | catalog | search | hidden`) — browse and search control. This is *not* `hideFromFriends`, which is social privacy; both stay, and both descriptions should say what the other one is for.
- **`soldIndividually`** (boolean) — max one per order.
- **`reviewsAllowed`** (boolean) — the seller does not want reviews.

**Both of the last two are advisory and must say so in their descriptions.** `soldIndividually` is a checkout constraint and checkout is not ours; `reviewsAllowed` is stronger — reviews are buyer-owned records in the buyer's repo, and no seller field can prevent one from existing. It is a request to applications, not enforcement. A field that reads as enforcement but isn't is worse than no field, so the wording carries real weight here.

**Keep out**: average rating and review count. A seller writing their own rating into their own record means nothing; apps count those. Already covered by INV10 — extend its withdrawn-field list to name them explicitly.

### B9. `buttonText` on external purchase (review, decision 1)

**Change**: optional `buttonText` on `#externalPurchase`, so the button reads "Buy on Etsy" rather than something generic. External purchase is Open Market's primary mode, and the label is part of making it not feel like a dead end.

Consider it on `#checkoutPurchase` too; the same argument applies more weakly.

### B10. Reviews of sellers, and review images (review §17)

**Now**: `review.subject` is documented as a productGroup or a standalone listing, and **INV6 actively rejects a shop URI**. Portable seller reputation was the original motivation for the whole proposal, and right now a seller's reputation is the sum of their product reviews and vanishes when they relist.

**Change**:

1. `subject` may point at a `shop`. This is a description change plus an INV6 change — the field is already an AT URI.
2. Add `images` to `review` (blob array, same shape as listing images). Photo reviews carry weight.

**Not now**: separate seller-rating dimensions (communication, shipping speed, item as described). See §D.

### B11. Shop presentation (review §15, remainder)

Add to `shop`: `banner` (blob) and `defaultCurrency` (ISO 4217).

`defaultCurrency` is **advisory** — a hint for clients composing new listings and for display when a shop has no listings yet. A listing's own `price.currency` is authoritative and never resolves through the shop. Say so in the description, or it becomes a second source of truth by accident.

`handlingTime` and `shipsTo` from the same review section are **not** here; they are A1.

---

## §C. Decide before implementing

### C1. How a variant says "inherit" (review §6)

The review proposes a literal `"parent"` sentinel on inheritable fields, giving three states: a real value means override, `"parent"` means inherit, missing means not set. It notes that platforms with variant products have used exactly this on title, sku, stock, weight, dimensions, tax class, shipping class, and image for years.

We currently use absence-means-inherit, decided in [boundaries.md](boundaries.md#inheritance-semantics-for-groupedvariant-listings-brief-item-4). It collapses the review's last two states: a variant cannot distinguish "inherit the group's images" from "deliberately have no images".

**Recommendation: keep absence-means-inherit.** Two reasons the sentinel proposal does not address:

1. **It does not work for the non-scalar fields.** `images` is a blob array, `classifications` and `specifications` are object arrays. The cited prior art applies `parent` to scalars — title, sku, weight, a single image. A sentinel that covers five of our eight inheritable fields and needs a different mechanism for the rest is worse than one rule.
2. **It collides with the value space.** A listing legitimately titled "parent" becomes ambiguous. Rare, but silent when it happens.

If the missing state turns out to matter in practice, the cheaper fix is an explicit `suppressInherited: ["images"]` array on the variant, which works uniformly for scalars and arrays and never collides with a value.

**This decision gates nothing else in the brief**, but it should be settled and written down before more implementations depend on the semantics — that is exactly how a schema acquires two incompatible readings.

---

## §D. Named seams, deliberately not built

Each of these has a trigger. Building before the trigger is speculation; building after it should require no change to the records above.

- **`license`** — usage rights for digital goods: commercial use, seats, territory, DRM. B4 puts four scalar fields on `#digitalDetails`, which is right for download terms and wrong for rights. **Trigger**: the first request that is about permission rather than delivery.
- **Seller rating dimensions** — communication, shipping speed, item as described, as separate scores. **Trigger**: an app that wants to render them. B10 makes shop-level reviews possible first; dimensions are additive on top and do not change `subject`.
- **`attestation`** — `{ issuer, subject, claim }`, the replacement for the `verified` boolean that was removed. Deferred item 9 in [boundaries.md](boundaries.md#not-implemented-and-why), and still correctly deferred. **Trigger**: a real issuer exists — a logistics receipt, a marketplace confirmation, an agent-checkout order record.
- **`catalog`** — canonical product identity across sellers. Deferred item 15. `identifiers[]` already provides the join key that delivers most of the benefit. **Trigger**: someone is prepared to answer who publishes the canonical record and who may edit it.

---

## Sequencing

Roughly in order of value per unit of work:

1. **B1** (`groupedItems`) — closes a hole we opened.
2. **B10** (shop reviews, review images) — unblocks the proposal's original motivation, and removes a validator rule that currently enforces the opposite.
3. **B3** (`priceIncludesTax`, minor-units wording) — silent data corruption is the worst kind.
4. **B5, B6, B7** — small, mechanical, each with an invariant consequence.
5. **B2, B4, B8, B9, B11** — additive fields, no invariant risk beyond reference checks.
6. **A1** (`fulfillmentProfile`) — a new record; do it as one piece rather than trickling fields onto `shop`.
7. **C1** — settle and document, whichever way it goes.
8. **A2** (`collection`) — only if wanted.

B1, B7, and B10 change `scripts/checks/invariants.js`; do those with the self-test corpus open beside them.
