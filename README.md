# AT Protocol Commerce Lexicon (Draft)

Draft Lexicon schemas for commerce on AT Protocol, developed as a synthesis of [Niizuki's proposal (discussion #4862)](https://github.com/bluesky-social/atproto/discussions/4862) and the production [Open Market](https://github.com/openmkt-app/marketplace) implementation.

Namespace is `app.temp.commerce.*` during development, intended to migrate to `lexicon-community` once stable.

## Records

| Record | Key | Purpose |
|---|---|---|
| **shop** | `self` | Commerce identity (one per account), separate from the Bluesky social profile |
| **productGroup** | `tid` | Optional grouping for variant products — declares option axes and is the source of truth for `category` and `type` |
| **listing** | `tid` | Polymorphic product/service/digital listing with structured pricing and inventory |
| **review** | `tid` | Product-level review with a denormalized variant snapshot |
| **defs** | — | Shared types: `price`, `location`, `variantProperty`, `optionAxis` |

## Key design decisions

- **Variants are addressable records**, not inline arrays. A standalone listing with no group is the default (zero ceremony for casual sellers). A `productGroup` appears only when variation exists; variant listings reference it via `partOf`.
- **Variant listings keep `title`, `category`, and `type` as required fields** even when `partOf` is set. These are denormalized mirrors — the group is source of truth. Same approach as the review variant snapshot: denormalize for resilience. Every listing is self-describing without fetching its group.
- **Price** is `{amount: integer, currency: string}` — minor currency units (cents), no floats, no bare strings.
- **Location** is internationalized: `{countryCode, region, locality, postalPrefix, isRemote}` replacing the US-centric model.
- **Polymorphism** via a `type` discriminator (`goods | service | digital`) with type-specific detail unions.
- **Reviews anchor to the product group** (durable), carrying a `variantSnapshot` of the variant properties at review time. The snapshot is self-contained — not anchored to any live variant listing. If variants are restructured, reviews stay valid and filterable.
- **Categories** use `knownValues` (an open/advisory set in atproto). Records with unknown slugs are protocol-valid; apps maintain canonical registries. This means adding a category is not a breaking Lexicon change.
- **Transactions, payments, and fulfillment** are explicitly out of scope — bridged via `externalUrl` / `checkoutUrl`.

## App-level invariants

The following constraints are real design requirements but **cannot be enforced by the Lexicon schema**. Implementing apps must enforce them:

1. **`type` ↔ `details` consistency.** A listing with `type: "goods"` should carry `goodsDetails` in its `details` union, not `serviceDetails`.
2. **Variant axis consistency.** A variant listing's `variantProperties` axes should be a subset of its group's declared `optionAxes`.
3. **Denormalized field consistency.** When `partOf` is set, `title`, `category`, and `type` should mirror the productGroup.
4. **`partOf` target type.** The `partOf` AT URI should reference an `app.temp.commerce.productGroup` record.

## Validation

```bash
npm install
npm run validate
```

The validator does two things:

1. **Schema registration** — loads all Lexicons (including the vendored `com.atproto.label.defs` at `lexicons/com/atproto/label/defs.json`) into a single `Lexicons` instance, confirming structural validity and cross-file ref resolution.
2. **Record validation** — validates sample records in `test/fixtures/` against the registered schemas, exercising the `labels` union, `details` union, variant properties, and all required fields. **A run with zero validated records is a failure (exit 1)**, so a missing `test/fixtures/` directory or empty fixture set cannot masquerade as success.

## Status

Draft — not yet proposed to `lexicon-community`. Open questions:

- **Schema evolution strategy** — document how fields are added without breaking existing apps.
- **Verified purchase** — `verified` is a placeholder boolean; logistics receipt token is the eventual direction.
