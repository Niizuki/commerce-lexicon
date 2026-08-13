# AT Protocol Commerce Lexicon (Draft)

Draft Lexicon schemas for commerce on AT Protocol, developed as a synthesis of [Niizuki's proposal (discussion #4862)](https://github.com/bluesky-social/atproto/discussions/4862) and the production [Open Market](https://github.com/openmkt-app/marketplace) implementation.

Namespace is `app.temp.commerce.*` during development, intended to migrate to `lexicon-community` once stable.

## Records

| Record | Key | Purpose |
|---|---|---|
| **shop** | `self` | Commerce identity (one per account), separate from the Bluesky social profile |
| **productGroup** | `tid` | Grouping for variant products — declares option axes and is the authoritative source for the product-level fields its variants inherit |
| **listing** | `tid` | A public offer: stable facts about the thing being sold |
| **inventory** | `any` | Stock state for one listing, separated because it changes continuously |
| **promotion** | `tid` | A temporary rule over one or more offers, with independent targeting and mechanism |
| **policy** | `tid` | A seller policy (returns, shipping, terms, privacy, warranty) with an effective period |
| **review** | `tid` | Buyer-owned review of a product, a standalone listing, or a shop, with a denormalized variant snapshot |
| **fulfillmentProfile** | `tid` | Where a seller ships and how soon they dispatch — destinations and handling time, never rates |
| **defs** | — | Shared types: `price`, `location`, `variantProperty`, `groupedItem`, `optionAxis`, `categorySlug`, `listingStructure`, `fulfillmentKind`, `vocabularyRef`, `specification`, `productIdentifier`, `physicalProperties`, `shippingInfo`, `taxInfo` |

The core is deliberately small. `shop` + `listing` is a complete publication; `inventory`, `promotion`, `policy`, and `fulfillmentProfile` are additive records a seller publishes only if they need them.

## Key design decisions

- **Three orthogonal listing dimensions, not one `type` enum.** `structure` (`simple | variant | grouped`), `fulfillmentKind` (`physical | digital | service`), and the `purchase` union (`#externalPurchase | #checkoutPurchase | #informational`) vary independently. A listing can be a variant, physical, and bought through an external checkout without any enum encoding that combination.
- **Variants are addressable records**, not inline arrays. A standalone listing with no group is the default (zero ceremony for casual sellers). A `productGroup` appears only when variation exists; variant listings reference it via `partOf`.
- **Variants inherit from their group; the group is the single source of truth.** `title`, `description`, `category`, `fulfillmentKind`, `classifications`, `specifications`, `brand`, and `images` may be omitted on a variant and resolve from `partOf`. A value on the listing overrides. Per-variant facts — `price`, `sku`, `variantProperties`, `identifiers`, `physical`, `condition` — never inherit. See [docs/boundaries.md](docs/boundaries.md#inheritance-semantics-for-groupedvariant-listings-brief-item-4) for why this replaced the earlier denormalized-mirror rule.
- **Inventory is its own record.** Listing metadata is stable for months; stock is not. Writing stock must not rewrite the listing. An inventory record reuses its subject listing's record key, so updates are idempotent puts. Group availability is never stored — it is `any(child available)`, computed by AppViews.
- **Promotions are separate records.** The listing carries one price, the normal/base offer. A promotion describes a temporary rule over it and never rewrites it. Targeting and mechanism are independent unions, so new mechanisms do not multiply record types, and several promotions may reference one listing.
- **Policies are separate records** with `effectiveFrom` / `effectiveUntil`, because offers made under a superseded policy still need to reference it.
- **Grouped listings carry their own composition.** `groupedItems[]` (`item`, `quantity`, `title`) says what a bundle contains, and the bundle publishes its own price — no per-item discount overrides, because two applications totalling prices held in other records can disagree and both be right. The composition is authored by the bundle and meaningless without it, so it stays inline; the *discount* is a promotion mechanism, which is the axis that genuinely separates.
- **Price** is `{amount: integer, currency: string}` — minor units, no floats, no bare strings. The exponent is per-currency from ISO 4217, **not** a fixed two digits: JPY has none and KWD has three, so unconditional divide-by-100 corrupts both.
- **Whether a price includes tax is stated on the offer**, as `tax.priceIncludesTax`. A federated marketplace has no shared configuration to settle it, so a VAT-inclusive and a tax-exclusive seller would otherwise write the identical record for different numbers. It sits on `taxInfo` rather than `price` because `price` is reused for sale prices, which need not answer the question, and it has no shop-level default because the shop is not authoritative over a listing's tax treatment.
- **Location** is internationalized: `{countryCode, region, locality, postalPrefix, isRemote}` replacing the US-centric model. A listing may carry its own — a pickup-only sofa in a shop that otherwise ships — and falls back to the shop's when absent.
- **Reviews anchor to the product group** (durable), carrying a `variantSnapshot` of the variant properties at review time. The snapshot is self-contained — not anchored to any live variant listing. If variants are restructured, reviews stay valid and filterable. A review may also anchor to a **shop**, which is what makes seller reputation portable instead of vanishing when a seller relists. Reviews carry no self-asserted verification; that is a claim for a separate attestation record from a third-party issuer.
- **Advisory fields say so.** `soldIndividually` is a checkout constraint and checkout is not ours; `reviewsAllowed` is weaker still, since reviews are buyer-owned records in the buyer's repo and nothing here can stop one existing; `shop.defaultCurrency` is a composition hint, never authoritative over a listing's own `price.currency`. A field that reads as enforcement but isn't is worse than no field.
- **Categories** use a curated 21-slug vocabulary defined once in `defs#categorySlug` and referenced by both `listing` and `productGroup`. It is an open/advisory `knownValues` set — records with unknown slugs stay protocol-valid and apps maintain canonical registries, so adding a category is not a breaking Lexicon change. The vocabulary is an editorial pass on Open Market's original list: `antiques` merged into `collectibles`; `cameras`, `cell_phones`, `computers` collapsed into `electronics`; `digital_arts` dropped (format is expressed by `fulfillmentKind`, content by the category); `Free Stuff` removed (a price state, `amount: 0`, not a category).
- **External vocabularies instead of universal ontologies.** `defs#vocabularyRef` (`scheme`, `identifier`, `version`) is how the schema names terms it deliberately does not define: detailed taxonomy (`classifications`), specification properties, shipping classes, and tax codes all point outward at independently versioned schemes.
- **Transactions, payments, rate calculation, and tax calculation are out of scope.** The schema supplies those systems' inputs — physical properties, shipping classification, tax status and code, purchase entry point, shipping destinations and handling time — without becoming one of them. `fulfillmentProfile` is the sharpest case: it says *where* and *how soon*, never *how much*.

## App-level invariants

The following are real design requirements that **cannot be enforced by the Lexicon schema**. Implementing apps must enforce them.

They are unenforceable *by a schema*, not unenforceable: given records that reference each other they are ordinary checks, and `npm run validate` enforces every one of them across the fixture corpus. The codes below are the codes the validator reports.

1. **(INV1) Structure ↔ `partOf`.** `structure: "variant"` iff `partOf` is set. A listing with no `partOf` is `simple` (the schema default).
2. **(INV2) Product-level fields on standalone listings.** `title`, `category`, and `fulfillmentKind` are required unless `partOf` is set. They are schema-optional only because Lexicon cannot express a conditional requirement.
3. **(INV3) Inheritance resolution.** When `partOf` is set and an inheritable field is absent, consumers must resolve it from the group before display or indexing.
4. **(INV4) `fulfillmentKind` ↔ `details` consistency.** A listing with `fulfillmentKind: "service"` should carry `serviceDetails` in `details`, not `digitalDetails`. A `physical` listing carries neither — physical properties are first-class fields.
5. **(INV5) Variant axis consistency.** A variant listing's `variantProperties` axes should be a subset of its group's declared `optionAxes`, and each value should be one the group declares for that axis. A property with **no** `value` spans the whole axis ("Red, any size"), so only its axis is checked.
6. **(INV6) Reference target types.** `partOf` and `promotion#productGroupTarget.ref` → `productGroup`; `inventory.subject`, `promotion#listingTarget.ref`, `groupedItems[].item`, and `productGroup.defaultVariant` → `listing`; `policy.subject`, `fulfillmentProfile.subject`, and `shopRef` → `shop`; `review.subject` → `productGroup`, `listing`, or `shop`.
7. **(INV7) One inventory record per listing.** Writers should key the inventory record by its subject listing's rkey — a documented convention, not a machine-checked rule. If duplicates exist, consumers should prefer the most recent `updatedAt`.
8. **(INV8) Promotion authority.** A promotion only applies to listings published by the DID that published the promotion; a `#shopTarget` means that seller's own listings.
9. **(INV9) Policy content.** At least one of `content` or `url` should be present.
10. **(INV10) Derived and withdrawn values are not written.** Group availability, price ranges, active promotion sets, and review aggregates (`ratingAverage`, `reviewCount`) are computed by AppViews, never stored. Nor do fields reappear after extraction: stock on the listing, policies on the shop, `handlingTime`/`shipsTo` on the shop, or the singular `details.fileFormat` that `fileFormats` replaced. Unknown properties are silently permitted by Lexicon, so this is the only thing standing between the schema and a quiet regression to its pre-boundary shape.
11. **(INV11) Grouped composition.** `structure: "grouped"` iff `groupedItems` is present, and a grouped listing must not list itself.
12. **(INV12) Default variant.** `productGroup.defaultVariant` must point at a listing whose `partOf` is that group. One belonging to another group renders as a confusing page rather than an obvious failure.

## Validation

```bash
npm run validate
```

`@atproto/lexicon` — the reference implementation — remains the authority on whether a record is well-formed. Around it the validator adds the checks a schema repo needs and Lexicon itself cannot make, in eight phases:

1. **Schema registration** — every lexicon (including the vendored `com.atproto.label.defs`) parses and registers into one `Lexicons` instance.
2. **Ref integrity** — every `ref` and union member resolves. `Lexicons.add()` resolves refs *lazily*, so a ref to a nonexistent def otherwise registers cleanly and is only caught if a fixture happens to exercise it.
3. **Valid fixtures** — every record in `test/fixtures/` validates, and carries no property the schema does not declare. The reference validator ignores unknown properties, so this is what catches a misspelled or withdrawn field name.
4. **Schema coverage** — every def in `app.temp.commerce.*` is exercised by at least one fixture.
5. **Invalid fixtures** — every record in `test/invalid/` is rejected, *with the expected message*. Without this, nothing proves the schema constrains anything.
6. **Forward compatibility** — every record in `test/forward-compat/` is *accepted* despite using undeclared extensions (an unregistered category slug, an unknown promotion mechanism or target, a `made_to_order` availability). The claim that the schema evolves additively is tested, not asserted. These fixtures need maintaining: once a round of work *declares* the value one of them uses, it keeps passing while testing nothing, and phase 6 cannot detect that — swapping in a still-undeclared value belongs in the same commit.
7. **App-level invariants** — the twelve rules above, checked across the whole fixture corpus.
8. **Invariant self-test** — the invariant checks run against a corpus built to violate each one, once per independent branch of the check, so a check that stops working — or one that starts firing on innocent records — fails the build.

Fixtures are addressed by `test/fixtures/manifest.json` and converted with `jsonToLex` before validation, exactly as records arriving over the wire are. See [docs/validation.md](docs/validation.md) for the design and for how to extend the corpus.

## Documentation

- [docs/boundaries.md](docs/boundaries.md) — why each boundary exists, what was deliberately deferred, and the full reasoning behind the variant inheritance decision.
- [docs/validation.md](docs/validation.md) — what the validator checks, why each phase exists, and how to add fixtures and invariants.
- [docs/next-implementation.md](docs/next-implementation.md) — the catalogue-completeness brief: thirteen gaps from auadix's field-level review. Implemented except for the optional `collection` record; see the banner there and §17 of boundaries.md.
- `docs/internal/` — local working notes (including the original synthesis brief). Untracked by design.

## Status

Draft — not yet proposed to `lexicon-community`. Open questions:

- **Schema evolution strategy** — document how fields are added without breaking existing apps. The largest remaining gap: the additive claim is tested per-record by phase 6, but the rules a contributor should follow are nowhere written down.
- **Attestations** — `review.verified` has been removed. A generic `Attestation { issuer, subject, claim }` record is the intended direction whenever a real issuer (logistics receipt, marketplace confirmation) exists, and needs no change to `review` when it lands.
- **Promotion mechanisms beyond `salePrice`** — percentage, fixed, buy-X-get-Y, free shipping, and bundle discounts are additive members of the existing union.
- **Collection concept** — specified in the catalogue-completeness brief but deliberately not built: it is the one item there no reviewer asked for. It stays open, along with the `#collectionTarget` promotion target that would point at it.
- **Digital licensing** — `#digitalDetails` now covers delivery terms (formats, size, download limit and expiry). Usage rights — commercial use, seats, territory — are a different question and wait on the first request that is about permission rather than delivery.
- **Seller rating dimensions** — communication, shipping speed, item as described, as separate scores. Shop-level reviews make them possible; they are additive on top and need no change to `review.subject`.
