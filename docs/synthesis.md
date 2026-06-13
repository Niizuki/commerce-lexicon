# AT Protocol Commerce Lexicon — Design Decisions Brief

Context: Synthesizing a commerce Lexicon for AT Protocol, merging a conceptual proposal (Niizuki, discussion #4862) with the production Open Market implementation (openmkt-app/marketplace, maintainer Al/auadix). Goal: one Lexicon serving both small/casual sellers and mid-size sellers with real inventory and variants. Transactions, payments, fulfillment, and dispute resolution are explicitly out of scope — bridged via a URL escape hatch.

Record types: three core records — shop, productGroup, listing — plus review. Namespace is `.temp.commerce.*` during development, migrating to lexicon-community once stable.

## 1. Variants — optional productGroup model (decided)

Variants are addressable records, not an inline array. A standalone listing with no group is the default and remains the trivial single-item case — zero ceremony for small sellers.

A productGroup record appears only when variation exists. Variant listing records reference it via a `partOf` AT URI.

Two-layer variant model: (a) option axes declared on the group (e.g. Color: [...], Size: [...]); (b) variant instances = concrete property tuples, each its own listing with its own price, quantity, sku, images.

Enumerate real variants only — never force the full Cartesian matrix (sparse matrices are normal).

Property values are free-text at the protocol level (optionally with well-known keys); normalization is pushed to a higher layer. No controlled value vocabularies in the base Lexicon.

Rationale: per-variant addressability is needed for reviews/likes; granular per-SKU inventory writes avoid record bloat; the simple case stays a single record.

## 2. Reviews — durable subject + property snapshot (decided)

`subject` = the productGroup/product AT URI (durable), not the variant. Reviews are long-lived PDS objects; variant records churn (discontinued, split, merged), so anchoring a review to a variant URI creates dangling refs.

The review carries a denormalized variant property snapshot captured at review time, e.g. `{color: "red", size: "M"}`. This makes reviews lossless and variant-filterable without depending on a live pointer.

Optional secondary `variantRef` AT URI for a live link when useful — not load-bearing.

Aggregation: product-level is trivial (subject is the product); variant-level views filter on the snapshot. Best-of-both without a one-way lossy projection.

Forward-compat: when verified-purchase (logistics receipt token) lands, the receipt is per-SKU — so subject = product, verification = variant, snapshot sourced from the receipt. Extends without rework.

### Rejected alternatives

- **Inline variant array on productGroup**: would prevent per-variant likes/reviews and cause write amplification when updating a single variant's inventory. Rejected.
- **subject = variant URI**: reviews become dangling refs when variants are discontinued or restructured. Forces a choice between data loss and complex migration tooling. Rejected.

## 3. Internationalization (decided with Al)

`price` = `{amount: integer (minor units), currency: ISO 4217}`. No floating point, no bare strings.

`location` = `{countryCode (ISO 3166-1), region, locality, postalPrefix, isRemote}`. Replaces the US-centric `{state, county, zipPrefix}`.

## 4. Availability / inventory (decided)

Optional `quantity` integer + `availability` enum (`in_stock | out_of_stock | pre_order | discontinued`). Enum computed from quantity or set independently when quantity is unknown. Lives per-variant listing.

## 5. Polymorphism (decided)

Listing is polymorphic via a `type` discriminator: `goods | service | digital` (rental/subscription as candidates). Type-specific fields via unions (e.g. service -> `slotsAvailable`, `turnaroundTime`). Replaces the loose `metadata: {subcategory}` bag.

## 6. Shop record (decided)

Distinct shop record (name, description, logo, website, business location) separating commerce identity from the Bluesky social profile. Listing carries an explicit AT URI reference to its parent shop (not just shared DID).

## 7. Category taxonomy (decided approach)

Source: Open Market's 26-category controlled vocabulary (with an "Other" fallback).

Protocol owns a controlled top-level enum keyed by stable slugs (e.g. `apparel`, `auto_parts`) with display labels in a separate i18n layer — never prose strings on the wire.

Subcategories live in a separately-versioned vocabulary doc, not enshrined in the Lexicon. Free-text fallback always permitted.

Cleanups required before adoption:
- Remove "Free Stuff" (it's a price state, `amount = 0`, not a category)
- Reconcile "Digital Arts & Commissions" with the `type: service|digital` discriminator
- Collapse overlap across Electronics / Computers & Tech / Cell Phones / Cameras and Antiques vs Collectibles

## Cross-cutting / still open

- **Schema evolution strategy** — document how fields are added without breaking existing apps (optional-field extension as the default story; explicit breaking-change policy).
- **Review subject convention** — write it down explicitly (product-level subject + snapshot, per above).
- **Verified purchase** — `verified` stays a placeholder; logistics receipt token is the eventual direction, per-SKU.

---

## Reconciliation Notes (from actual listing.json)

Divergences found when comparing `lexicons/app/openmkt/marketplace/listing.json` against this brief:

1. **`metadata` is nearly empty** — only contains `subcategory`. Polymorphism is net-new structure, not draining an existing dumping ground.
2. **`hideFromFriends`** — boolean not in the brief, carried forward into new schema.
3. **`condition`** — plain string in current schema, constrained to enum in new schema. Existing values from app: `new`, `openBox`, `likeNew`, `good`, `fair`, `forParts`.
4. **`category`** — plain string in current schema, becomes knownValues enum in new schema.
5. **Two namespace copies** — `app.openmkt` (canonical, has `labels` + `currency`) and `app.atprotomkt` (older).
6. **`labels`** — atproto `selfLabels` union, must survive into new schema.
