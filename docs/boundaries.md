# Commerce Schema Boundaries — Implementation Record

This records how the architectural brief in `Instructions.txt` was implemented, section by section, and what was deliberately left undone. It is the reference for *why* the schema is shaped this way; the README is the reference for *what* the schema is.

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

Unchanged and intended. `Shop` + `Listing` is a complete publication. `Inventory`, `Promotion`, `Policy` are additive. Large sellers reach external taxonomy, specification, fulfillment, and tax systems through reference fields rather than through core schema changes.

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

---

## Not implemented, and why

**Generic attestation model (brief item 9).** The brief makes it conditional — "if verification becomes necessary" — and nothing currently consumes an attestation. Removing `review.verified` was the part that mattered: it is what would otherwise have hardened into protocol. The `Attestation { issuer, subject, claim }` shape stays available as a new record type whenever a real issuer exists, and needs no change to `review` when it arrives.

**Deferred by the brief (items 10–15).** Full promotion engine, checkout enforcement, fulfillment and rate calculation, tax calculation, inventory reservations, canonical federated product catalog. Each has a seam in place: an open mechanism union, a purchase-mechanism union, `shipping` classification, `taxInfo`, an inventory record that can grow location and reservation fields, and product identifiers.

**Collection and taxonomy promotion targets.** Named in the brief as eventual. `targets` is a union, so they are additive members; there is no `collection` concept in the schema yet to point at.
