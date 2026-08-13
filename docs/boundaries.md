# Commerce Schema Boundaries — Implementation Record

This records how the original architectural brief was implemented, section by section, and what was deliberately left undone. It is the reference for *why* the schema is shaped this way; the README is the reference for *what* the schema is.

The brief itself (`Instructions.txt`) has been retired now that it is fully implemented. Its sections survive here under the same numbering, so a reference to §13 means §13 of this document. The next round of work is specified separately in [next-implementation.md](next-implementation.md).

The rule applied throughout: when a convenient special case in the core competed with a boundary that lets a subsystem evolve independently, the boundary won.

---

## 1. Core commerce schema

The core is `shop`, `productGroup`, `listing`, plus the shared `defs`. It carries the concepts the brief lists as core: title and description, images, brand, SKU, external product identifiers, condition, coarse category, tags, base price, physical properties, basic shipping classification, basic tax classification.

Added to `listing` in this pass: `brand`, `identifiers`, `tags`, `physical`, `shipping`, `tax`, `classifications`, `specifications`.

A seller can still publish only `shop` + `listing` and participate fully. Everything else is optional and additive.

## 2. Listing dimensions split

`type: goods | service | digital` is gone. It conflated three unrelated questions, so it became three independent fields:

| Dimension | Field | Values |
|---|---|---|
| Structure | `structure` → `defs#listingStructure` | `simple`, `variant`, `grouped` (default `simple`) |
| Delivery kind | `fulfillmentKind` → `defs#fulfillmentKind` | `physical`, `digital`, `service` |
| Purchase mechanism | `purchase` union | `#externalPurchase`, `#checkoutPurchase`, `#informational` |

They compose freely: a variant + physical + external-checkout listing is expressible without a combinatorial enum.

`purchase` is a union rather than an enum plus optional URL fields, so each mechanism carries exactly the data it needs and a new mechanism cannot force conditional fields onto listings that do not use it. This replaces the previous `externalUrl` / `checkoutUrl` pair.

`goodsDetails` was dropped: its only field was `shippingWeight`, and physical properties are core fields now, not union members. `serviceDetails` and `digitalDetails` remain, holding facts that are genuinely kind-specific.

## 3. Promotions extracted

New record `app.temp.commerce.promotion`. The listing keeps one price — the normal/base offer — and a promotion is a separate record describing a temporary rule over it. No listing field is ever rewritten by a promotion.

Targeting and mechanism are separate unions, exactly to avoid the `ProductPercentageDiscount` / `GroupPercentageDiscount` / `CategoryPercentageDiscount` explosion:

- `targets[]`: `#listingTarget`, `#productGroupTarget`, `#shopTarget` (seller-wide). Collection and taxonomy targets are additive union members when those concepts exist.
- `mechanism`: `#salePrice` only. Percentage discount, fixed discount, buy-X-get-Y, free shipping, and bundle discounts are additive members of the same union.

Because promotions are their own records, several can reference one listing; deciding which are active and applicable is AppView work.

Out of scope by design: redemption limits, coupon consumption, account eligibility, reservation, payment enforcement. The protocol advertises promotions, it does not enforce them.

## 4. Inventory extracted

New record `app.temp.commerce.inventory`. `availability` and `quantity` were removed from `listing`, along with `serviceDetails.slotsAvailable`, which was inventory wearing a different name.

The motivation is lifecycle, not tidiness: a title or photograph is stable for months while stock moves continuously, and writing stock should not rewrite the listing.

Record key is `any`, with the convention that an inventory record reuses its subject listing's record key. Stock updates then become idempotent `putRecord` calls at a known address instead of a list-and-search. The alternative, `tid` keys, forces every writer to maintain a listing→inventory mapping for the highest-churn record in the system.

`updatedAt` is required and there is no `createdAt`: only the current state matters, and consumers need the assertion time to judge freshness.

Group availability is *not* stored. It is `any(child listing is available)` and belongs in AppViews — a second authoritative value on the group would be a second source of truth.

## 5. Policies extracted

New record `app.temp.commerce.policy`, with `subject` → shop, `kind`, `content` / `url`, and `effectiveFrom` / `effectiveUntil`.

The reason is historical state: a seller may change a returns policy, but offers made under the previous one still need to name it. Superseded policies should be retained with `effectiveUntil` set rather than deleted. `shop` gained no policy fields, so mutable policy never becomes inseparable from seller identity.

## 6. Taxonomy references

`defs#vocabularyRef` (`scheme`, `identifier`, `version`) is the pointer into an external, independently versioned vocabulary. `listing.classifications` and `productGroup.classifications` are arrays of it, so one listing can participate in several classification systems at once.

`subcategory` — free text with no scheme — was removed; it is precisely the interoperability failure the brief warns about. `category` stays as the coarse 21-slug vocabulary useful to simple applications.

## 7. Structured specifications

`defs#specification` is `{ property: vocabularyRef, value, unit? }`, on both `listing` and `productGroup`.

Naming the property through a scheme is what keeps `Screen Size = 27"`, `screen_size = 27 inch`, and `Display diagonal = 686 mm` from being three unrelated facts. `scheme` is optional so the simple case still works, with the explicit understanding that a scheme-less identifier is seller-local. A future category-aware vocabulary can define which properties are meaningful without changing this shape.

## 8. Fulfillment and shipping

Intrinsic facts live on the listing: `physical` (dimensions, weight), `shipping.required`, `shipping.class`, `fulfillmentKind`. Shipping class is a `vocabularyRef`, not an enum.

Destinations, methods, rate calculation, pickup locations, routing, and providers are absent on purpose. The schema supplies a fulfillment system's inputs without becoming one.

## 9. Tax

`defs#taxInfo` carries `status` (coarse, advisory `knownValues`) and `classification` (a `vocabularyRef`, so tax codes come from real external schemes rather than one enum assumed to be globally sufficient).

No rate tables, jurisdiction rules, calculation, collection, or customer-specific determination.

## 10. Canonical product identity — deferred

`listing.identifiers[]` and `productGroup.identifiers[]` (`defs#productIdentifier`) give GTIN/ISBN/MPN/ASIN as a cross-seller join key today. That is most of the near-term interoperability benefit.

A canonical `Product` / `Offer` split is explicitly not attempted. Who publishes the canonical record, who may edit it, how competing records and conflicting identifiers resolve — those are larger questions than this protocol, and a future `catalog` domain can take them up without changing these records.

## 11. Reviews and attestations

`review.verified` was removed. Verification is a claim about the author, made by someone else; a self-asserted boolean is not evidence and embeds a trust decision into the record. Reviews stay buyer-owned and portable.

No attestation record was added — see *Not implemented* below.

## 12. Derived state

Nothing derivable is stored. Specifically absent: group availability, active promotion sets, variant price ranges, minimum/maximum variant price, review aggregates, inventory aggregates. AppViews compute and cache these.

## 13. Boundary rule

Applied as stated. Promotion, inventory, and policy each satisfy several conditions at once (different lifecycle, multiple simultaneous instances, relationship rather than intrinsic property, room to grow into a subsystem). Physical properties, tax status, and shipping class satisfy none of them and stayed inline — extracting them would be fragmentation without benefit.

## 14. Layering

```
                      Commerce Core
                           |
          +----------------+----------------+
          |                |                |
         Shop         Product Group       Listing
                                             |
          +----------------+----------------+----------------+
          |                |                |                |
      Promotion         Inventory         Review          Policy
```

All four leaf records exist. External domains are reached through references, not through core fields: taxonomy and specifications through `vocabularyRef`, catalog identity through `productIdentifier`, fulfillment and tax through classification fields that name external schemes.

## 15. Implementation priority

Near-term items 1–5: done. Medium-term items 6–8: done. Item 9 and the deferred items 10–15 are listed below.

## 16. Multi-level usability

Unchanged and intended. `Shop` + `Listing` is a complete publication. `Inventory`, `Promotion`, `Policy`, and now `FulfillmentProfile` are additive. Large sellers reach external taxonomy, specification, fulfillment, and tax systems through reference fields rather than through core schema changes.

---

## 17. Catalogue completeness (second round)

The first round answered the *architectural* half of auadix's review of [discussion #4862](https://github.com/bluesky-social/atproto/discussions/4862#discussioncomment-17901346). The field-level half — could a real shop describe its full catalogue without losing anything? — was specified in [next-implementation.md](next-implementation.md) and implemented here. The boundary rule in §13 decided each item; what follows is where it landed and, for the inline cases, why extraction would have been fragmentation.

**One new record.** `app.temp.commerce.fulfillmentProfile` (`subject` → shop, `handlingTime`, `coverage`). `handlingTime` and `shipsTo` were asked for *on the shop record*, and that is where they could not go: §8 names destinations and delivery promises as a fulfillment system's concern, and the first two fields of one, planted inside seller identity, would oblige pickup locations, per-class handling, and regional cutoffs to follow them there. Coverage also changes with carrier contracts and seasons while a shop's name and logo do not. The key is `tid`, not `self`, because several profiles per shop is the point — EU in two days, worldwide in ten. Rates, carrier selection, and label generation stay out: the record says where and how soon, never how much.

**Eleven sets of inline fields**, each intrinsic to the record it sits on:

| Item | Change | Why not a record |
|---|---|---|
| B1 | `listing.groupedItems[]` via `defs#groupedItem` | Composition is authored by the bundle and meaningless without it — no separate author, no multiple instances. It is already split along the axis that matters: composition here, discount as a promotion mechanism. |
| B2 | `listing.location`, falling back to the shop's | Where the item *is* is intrinsic. Local pickup as a *method* is the fulfillment profile's. |
| B3 | `taxInfo.priceIncludesTax`; ISO 4217 exponent wording on `price.amount` | One flag on the offer. Not on `#price`, which is reused for sale prices that need not answer it; no shop-level default, because the shop is not authoritative over an item's tax treatment. |
| B4 | `#digitalDetails`: `fileFormats[]`, `fileSize`, `downloadLimit`, `downloadExpiryDays` | Terms the buyer needs *before* buying, so they belong on the public listing rather than in a transaction system. No file URL — the record is public, and publishing the location gives the product away. |
| B5 | `backorder` availability; `inventory.lowStockThreshold` | Already the right record. `pre_order` and `backorder` are different promises — not yet released versus out of stock but still orderable — so they are different states. |
| B6 | `defs#variantProperty.value` made optional | Absence spans the axis: "Red, any size, £20". |
| B7 | `productGroup.defaultVariant` | A pointer within the group it already belongs to. |
| B8 | `shortDescription`, `catalogVisibility`, `soldIndividually`, `reviewsAllowed` | Display and control facts about one listing. `catalogVisibility` is browse/search placement and `hideFromFriends` is social privacy; both descriptions name the other so the pair does not collapse. |
| B9 | `buttonText` on `#externalPurchase` and `#checkoutPurchase` | A label on the mechanism that already exists. External purchase is Open Market's primary mode, and naming the destination is what keeps it from reading as a dead end. |
| B10 | `review.subject` may be a shop; `review.images[]` | Reviews were already their own buyer-owned records; only the permitted anchor widened. |
| B11 | `shop.banner`, `shop.defaultCurrency` | Presentation of the shop itself. |

`ratingAverage` and `reviewCount` were **not** added, in either place they were tempting. A seller writing their own rating into their own record means nothing; §12 already forbids it, and INV10 now names both explicitly.

`soldIndividually`, `reviewsAllowed`, and `defaultCurrency` are advisory, and their descriptions say so. `reviewsAllowed` is the one that most needs the wording: reviews live in the buyer's repo, so no seller field can prevent one existing. A field that reads as enforcement but isn't is worse than no field.

**Two new invariants.** INV11 (a grouped listing says what it groups and does not group itself) and INV12 (a default variant belongs to its own group) — both are the kind of error that renders as a confusing page rather than an obvious failure. INV5 learned to skip value-membership for a value-less property while still checking the axis, and INV10 learned to read nested paths, which is how a withdrawn field inside a union member (`details.fileFormat`) is caught at all.

**One maintenance trap, now documented.** Two forward-compatibility fixtures proved extensibility with values this round declared. `backorder` became a `knownValue`, so `unknown-availability.json` moved to `made_to_order`. Such a fixture keeps passing while testing nothing, and phase 6 cannot detect it — the swap belongs in the commit that declares the value. `test/forward-compat/manifest.json` now says so.

---

## Inheritance semantics for grouped/variant listings (brief item 4)

This was the one place the brief left genuinely open, and it is the decision most likely to be revisited, so the reasoning is recorded in full.

**Decision: the group is authoritative and variants inherit. Product-level fields are optional on a variant listing and resolve from `partOf` when absent.**

Resolution rule, applied by any consumer:

> For an inheritable field, if the listing carries a value, that value wins. Otherwise, if `partOf` is set, take the group's value. Otherwise the field is absent.

Inheritable: `title`, `description`, `category`, `fulfillmentKind`, `classifications`, `specifications`, `brand`, `images`.

Not inheritable: `price`, `sku`, `variantProperties`, `identifiers`, `physical`, `condition` — these are per-variant facts, and inheriting them would be wrong rather than merely redundant. `identifiers` on a group are product-wide; a per-variant GTIN belongs on the variant.

The rejected alternative was the previous rule: keep `title`, `category`, and `type` required on variants as denormalized mirrors, so every listing is self-describing without a fetch. That is convenient for consumers, but it makes the group and the variant both authoritative for the same fact, and nothing in the protocol can keep them from diverging. The brief rejects exactly this pattern for group availability, and its boundary rule treats derived state as a reason to extract, not to duplicate. Cheap reads are an AppView's job — an AppView resolves inheritance once at index time and serves fully-resolved listings.

The cost is real and is accepted: `title`, `category`, and `fulfillmentKind` can no longer be schema-required, because Lexicon cannot express "required unless `partOf` is set". They move to the app-level invariant list in the README, alongside the invariants the schema already could not enforce.

### Revisited: the `"parent"` sentinel (brief item C1)

The review proposed a literal `"parent"` sentinel on inheritable fields, giving three states rather than two: a real value overrides, `"parent"` inherits, missing means not set. It noted that platforms with variant products have used exactly this for years, on title, sku, stock, weight, dimensions, tax class, shipping class, and image.

The gap it identifies is real. Absence-means-inherit collapses the last two states, so a variant cannot say "deliberately no images" as distinct from "take the group's images".

**Decision: keep absence-means-inherit.** Two objections the proposal does not answer:

1. **It does not work for the non-scalar fields.** `images` is a blob array; `classifications` and `specifications` are object arrays. The cited prior art applies `parent` to scalars. A sentinel covering five of our eight inheritable fields, with a second mechanism for the other three, is worse than one rule that covers all eight.
2. **It collides with the value space.** A listing legitimately titled "parent" becomes ambiguous. Rare, and silent when it happens — the worst combination.

If the missing state turns out to matter in practice, the cheaper fix is an explicit `suppressInherited: ["images"]` array on the variant: uniform across scalars and arrays, and incapable of colliding with a value. It is additive, so nothing here has to change first.

This gates nothing else, but it needed settling and writing down before more implementations depend on the semantics — two incompatible readings of an inheritance rule is exactly how a schema acquires a permanent ambiguity.

---

## Not implemented, and why

**Generic attestation model (brief item 9).** The brief makes it conditional — "if verification becomes necessary" — and nothing currently consumes an attestation. Removing `review.verified` was the part that mattered: it is what would otherwise have hardened into protocol. The `Attestation { issuer, subject, claim }` shape stays available as a new record type whenever a real issuer exists, and needs no change to `review` when it arrives.

**Deferred by the brief (items 10–15).** Full promotion engine, checkout enforcement, fulfillment and rate calculation, tax calculation, inventory reservations, canonical federated product catalog. Each has a seam in place: an open mechanism union, a purchase-mechanism union, `shipping` classification, `taxInfo`, an inventory record that can grow location and reservation fields, and product identifiers.

**Collection and taxonomy promotion targets.** Named in the brief as eventual. `targets` is a union, so they are additive members; there is no `collection` concept in the schema yet to point at.

**`collection` (catalogue-completeness brief A2).** Specified there, and the only item in that brief no reviewer asked for — the brief itself marks it optional and says the rest is unaffected if it is skipped. It was skipped. Building a record so that an already-sketched promotion target has something to point at is the wrong order; the trigger is someone wanting a seller-curated set. The shape and the membership-direction argument (items listed on the collection, not declared by each listing) are recorded in the brief for whoever needs them.

**`license` for digital goods.** Usage rights — commercial use, seats, territory, DRM — as distinct from the delivery terms B4 added. **Trigger**: the first request that is about permission rather than delivery.

**Seller rating dimensions.** Communication, shipping speed, item as described, as separate scores. Shop-level reviews had to exist first, and now do. **Trigger**: an application that wants to render them.
