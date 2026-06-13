# AT Protocol Commerce Lexicon (Draft)

Draft Lexicon schemas for commerce on AT Protocol, developed as a synthesis of [Niizuki's proposal (discussion #4862)](https://github.com/bluesky-social/atproto/discussions/4862) and the production [Open Market](https://github.com/openmkt-app/marketplace) implementation.

Namespace is `temp.commerce.*` during development, intended to migrate to `lexicon-community` once stable.

## Records

| Record | Purpose |
|---|---|
| **shop** | Commerce identity separate from the Bluesky social profile (name, description, logo, website, location) |
| **productGroup** | Optional grouping for variant products — declares option axes (e.g. Color, Size) that variant listings enumerate |
| **listing** | Polymorphic product/service/digital listing with structured pricing, inventory, and optional variant references |
| **review** | Product-level review with a denormalized variant snapshot for filtering without dangling refs |
| **defs** | Shared types: `price`, `location`, `variantProperty`, `optionAxis` |

## Key design decisions

- **Variants are addressable records**, not inline arrays. A standalone listing with no group is the default (zero ceremony for casual sellers). A `productGroup` appears only when variation exists; variant listings reference it via `partOf`.
- **Price** is `{amount: integer, currency: string}` — minor currency units (cents), no floats, no bare strings.
- **Location** is internationalized: `{countryCode, region, locality, postalPrefix, isRemote}` replacing the US-centric model.
- **Polymorphism** via a `type` discriminator (`goods | service | digital`) with type-specific detail unions.
- **Reviews anchor to the product group** (durable), carrying a `variantSnapshot` of the variant properties at review time. If variants are restructured, reviews stay valid and filterable.
- **Categories** use a controlled vocabulary of stable slugs with free-text subcategory alongside.
- **Transactions, payments, and fulfillment** are explicitly out of scope — bridged via `externalUrl` / `checkoutUrl`.

## Validation

These schemas validate against `@atproto/lexicon`. To check:

```bash
npm install @atproto/lexicon
node scripts/validate-lexicon.js
```

## Status

Draft — not yet proposed to `lexicon-community`. Open questions documented in the design brief.
