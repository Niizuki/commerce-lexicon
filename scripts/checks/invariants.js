// App-level invariants: the design requirements Lexicon cannot express.
//
// These are documented in the README as constraints implementing apps must enforce.
// They are unenforceable *by a Lexicon schema*, not unenforceable — given a corpus of
// records that reference each other, they are ordinary checks. Codes are stable and
// map 1:1 to the numbered list in the README.
//
// Each check returns violations as { code, file, message }.

const LISTING = 'app.temp.commerce.listing';
const PRODUCT_GROUP = 'app.temp.commerce.productGroup';
const SHOP = 'app.temp.commerce.shop';
const INVENTORY = 'app.temp.commerce.inventory';
const PROMOTION = 'app.temp.commerce.promotion';
const POLICY = 'app.temp.commerce.policy';
const REVIEW = 'app.temp.commerce.review';
const FULFILLMENT_PROFILE = 'app.temp.commerce.fulfillmentProfile';
const COLLECTION = 'app.temp.commerce.collection';
const LICENSE = 'app.temp.commerce.license';

const INHERITED = ['title', 'description', 'category', 'fulfillmentKind', 'classifications', 'specifications', 'brand', 'images', 'license'];
const PRODUCT_LEVEL = ['title', 'category', 'fulfillmentKind'];

const DETAILS_FOR_KIND = {
  service: `${LISTING}#serviceDetails`,
  digital: `${LISTING}#digitalDetails`,
  physical: null, // physical facts are first-class fields, not a union member
};

// Fields that were extracted into their own records or are derived by AppViews.
// The schema cannot catch these — unknown properties are silently permitted — and
// they are exactly what a regression to the pre-boundary shape looks like.
// A dotted key reads through nested objects, which is how a withdrawn field inside
// a union member (details.fileFormat) is caught.
const WITHDRAWN_FIELDS = {
  [LISTING]: {
    availability: 'moved to the inventory record',
    quantity: 'moved to the inventory record',
    slotsAvailable: 'moved to the inventory record',
    type: 'split into structure, fulfillmentKind, and purchase',
    subcategory: 'replaced by classifications (vocabularyRef)',
    externalUrl: 'replaced by the purchase union',
    checkoutUrl: 'replaced by the purchase union',
    regularPrice: 'the listing carries one base price; sales are promotion records',
    salePrice: 'sales are promotion records',
    saleStartsAt: 'sales are promotion records',
    saleEndsAt: 'sales are promotion records',
    ratingAverage: 'derived by AppViews; a seller rating themselves means nothing',
    reviewCount: 'derived by AppViews',
    'details.fileFormat': 'replaced by fileFormats; one format cannot describe an asset pack',
  },
  [SHOP]: {
    handlingTime: 'moved to the fulfillmentProfile record',
    shipsTo: 'moved to fulfillmentProfile#coverage',
    returnPolicy: 'policies are their own records, so superseded versions stay resolvable',
    shippingPolicy: 'policies are their own records',
  },
  [PRODUCT_GROUP]: {
    availability: 'derived from child listings by AppViews',
    quantity: 'derived from child listings by AppViews',
    type: 'renamed to fulfillmentKind',
    price: 'price is per-variant',
    priceRange: 'derived by AppViews',
    minPrice: 'derived by AppViews',
    maxPrice: 'derived by AppViews',
    reviewCount: 'derived by AppViews',
    ratingAverage: 'derived by AppViews',
  },
  [REVIEW]: {
    verified: 'verification is a third-party attestation, not a self-asserted field',
  },
};

// field -> collections the AT URI may point at. partOf existence is checked by INV3.
const REFERENCE_TARGETS = [
  { nsid: LISTING, field: 'shopRef', allow: [SHOP] },
  { nsid: LISTING, field: 'partOf', allow: [PRODUCT_GROUP], skipExistence: true },
  { nsid: LISTING, field: 'license', allow: [LICENSE] },
  { nsid: PRODUCT_GROUP, field: 'shopRef', allow: [SHOP] },
  { nsid: PRODUCT_GROUP, field: 'defaultVariant', allow: [LISTING] },
  { nsid: PRODUCT_GROUP, field: 'license', allow: [LICENSE] },
  { nsid: COLLECTION, field: 'shopRef', allow: [SHOP] },
  { nsid: LICENSE, field: 'subject', allow: [SHOP] },
  { nsid: INVENTORY, field: 'subject', allow: [LISTING] },
  { nsid: POLICY, field: 'subject', allow: [SHOP] },
  { nsid: PROMOTION, field: 'shopRef', allow: [SHOP] },
  { nsid: REVIEW, field: 'subject', allow: [PRODUCT_GROUP, LISTING, SHOP] },
  { nsid: FULFILLMENT_PROFILE, field: 'subject', allow: [SHOP] },
];

/** Read a possibly-dotted path out of a record, for the nested withdrawn fields. */
const readPath = (record, path) =>
  path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), record);

export function parseAtUri(uri) {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri ?? '');
  return match ? { did: match[1], collection: match[2], rkey: match[3] } : null;
}

/**
 * @param corpus array of { file, uri, did, collection, rkey, nsid, record }
 */
export function checkInvariants(corpus) {
  const byUri = new Map(corpus.map((entry) => [entry.uri, entry]));
  const of = (nsid) => corpus.filter((entry) => entry.nsid === nsid);
  const violations = [];
  const report = (code, entry, message) => violations.push({ code, file: entry.file, message });

  // INV1 — structure "variant" iff partOf is set.
  for (const entry of of(LISTING)) {
    const structure = entry.record.structure ?? 'simple';
    if (entry.record.partOf && structure !== 'variant') {
      report('INV1', entry, `partOf is set but structure is '${structure}'; a listing in a group is a variant`);
    }
    if (!entry.record.partOf && structure === 'variant') {
      report('INV1', entry, `structure is 'variant' but no partOf is set`);
    }
  }

  // INV2 — product-level fields are required on a listing that inherits nothing.
  for (const entry of of(LISTING)) {
    if (entry.record.partOf) continue;
    const missing = PRODUCT_LEVEL.filter((field) => entry.record[field] === undefined);
    if (missing.length) {
      report('INV2', entry, `standalone listing is missing ${missing.join(', ')} (schema-optional only because Lexicon cannot express "required unless partOf is set")`);
    }
  }

  // INV3 — a variant must be able to resolve its inherited fields from its group.
  for (const entry of of(LISTING)) {
    const { partOf } = entry.record;
    if (!partOf) continue;
    const parsed = parseAtUri(partOf);
    if (parsed?.collection !== PRODUCT_GROUP) continue; // wrong collection is INV6's report
    const group = byUri.get(partOf);
    if (!group) {
      report('INV3', entry, `partOf points at ${partOf}, which is not in the corpus, so inherited fields cannot be resolved`);
      continue;
    }
    const unresolved = PRODUCT_LEVEL.filter(
      (field) => entry.record[field] === undefined && group.record[field] === undefined,
    );
    if (unresolved.length) {
      report('INV3', entry, `${unresolved.join(', ')} resolves to nothing: absent on the listing and on ${group.file}`);
    }
  }

  // INV4 — details must match the resolved fulfillmentKind.
  for (const entry of of(LISTING)) {
    const details = entry.record.details;
    if (!details) continue;
    const kind = resolveField(entry, 'fulfillmentKind', byUri);
    if (kind === undefined) continue;
    const expected = DETAILS_FOR_KIND[kind];
    if (expected === undefined) continue; // unknown kind: knownValues are advisory
    if (expected === null) {
      report('INV4', entry, `fulfillmentKind '${kind}' takes no details member (physical facts are first-class fields), but details is ${details.$type}`);
    } else if (details.$type !== expected) {
      report('INV4', entry, `fulfillmentKind '${kind}' expects ${expected}, but details is ${details.$type}`);
    }
  }

  // INV5 — a variant's properties must be drawn from the group's declared axes.
  for (const entry of of(LISTING)) {
    const group = entry.record.partOf ? byUri.get(entry.record.partOf) : null;
    if (!group) continue;
    const axes = new Map((group.record.optionAxes ?? []).map((axis) => [axis.name, axis.values ?? []]));
    for (const property of entry.record.variantProperties ?? []) {
      if (!axes.has(property.axis)) {
        report('INV5', entry, `variant axis '${property.axis}' is not declared in ${group.file} (declared: ${[...axes.keys()].join(', ')})`);
      } else if (property.value === undefined) {
        // A property with no value spans the whole axis, so there is no membership
        // to check — but the axis itself still has to be one the group declares.
        continue;
      } else if (!axes.get(property.axis).includes(property.value)) {
        report('INV5', entry, `value '${property.value}' is not among the values ${group.file} declares for axis '${property.axis}'`);
      }
    }
  }

  // INV6 — AT URIs must point at the right collection, and at a record that exists.
  for (const entry of corpus) {
    for (const rule of REFERENCE_TARGETS) {
      if (entry.nsid !== rule.nsid) continue;
      checkReference(entry, entry.record[rule.field], rule, rule.field);
    }
    if (entry.nsid === LISTING) {
      (entry.record.groupedItems ?? []).forEach((item, i) => {
        checkReference(entry, item.item, { allow: [LISTING] }, `groupedItems/${i}/item`);
      });
    }
    if (entry.nsid === COLLECTION) {
      (entry.record.items ?? []).forEach((uri, i) => {
        checkReference(entry, uri, { allow: [LISTING, PRODUCT_GROUP] }, `items/${i}`);
      });
    }
    if (entry.nsid === PROMOTION) {
      (entry.record.targets ?? []).forEach((target, i) => {
        const allow =
          target.$type === `${PROMOTION}#listingTarget` ? [LISTING]
          : target.$type === `${PROMOTION}#productGroupTarget` ? [PRODUCT_GROUP]
          : target.$type === `${PROMOTION}#collectionTarget` ? [COLLECTION]
          : null;
        if (allow) checkReference(entry, target.ref, { allow }, `targets/${i}/ref`);
      });
    }
  }

  function checkReference(entry, uri, rule, label) {
    if (uri === undefined) return;
    const parsed = parseAtUri(uri);
    if (!parsed) {
      report('INV6', entry, `${label} is not a well-formed AT URI: ${uri}`);
      return;
    }
    if (!rule.allow.includes(parsed.collection)) {
      report('INV6', entry, `${label} points at collection ${parsed.collection}; expected ${rule.allow.join(' or ')}`);
      return;
    }
    if (!rule.skipExistence && !byUri.has(uri)) {
      report('INV6', entry, `${label} points at ${uri}, which is not in the corpus`);
    }
  }

  // INV7 — at most one inventory record per listing.
  const inventoryBySubject = new Map();
  for (const entry of of(INVENTORY)) {
    const subject = entry.record.subject;
    if (!inventoryBySubject.has(subject)) inventoryBySubject.set(subject, []);
    inventoryBySubject.get(subject).push(entry);
  }
  for (const [subject, entries] of inventoryBySubject) {
    if (entries.length > 1) {
      report('INV7', entries[0], `${entries.length} inventory records share subject ${subject} (${entries.map((e) => e.file).join(', ')}); stock state must have one writer`);
    }
  }

  // INV8 — a promotion only binds records published by the DID that issued it.
  for (const entry of of(PROMOTION)) {
    const shopDid = parseAtUri(entry.record.shopRef)?.did;
    if (shopDid && shopDid !== entry.did) {
      report('INV8', entry, `promotion is published by ${entry.did} but shopRef belongs to ${shopDid}`);
    }
    (entry.record.targets ?? []).forEach((target, i) => {
      const targetDid = target.ref ? parseAtUri(target.ref)?.did : null;
      if (targetDid && targetDid !== entry.did) {
        report('INV8', entry, `targets/${i} points at a record owned by ${targetDid}, but the promotion is published by ${entry.did}`);
      }
    });
  }

  // INV9 — a policy must say something.
  for (const entry of of(POLICY)) {
    if (!entry.record.content && !entry.record.url) {
      report('INV9', entry, `policy has neither content nor url`);
    }
  }

  // INV10 — extracted and derived fields must not reappear.
  for (const entry of corpus) {
    const withdrawn = WITHDRAWN_FIELDS[entry.nsid];
    if (!withdrawn) continue;
    for (const [field, reason] of Object.entries(withdrawn)) {
      if (readPath(entry.record, field) !== undefined) {
        report('INV10', entry, `'${field}' must not be written: ${reason}`);
      }
    }
  }

  // INV11 — a grouped listing must say what it groups, and must not group itself.
  for (const entry of of(LISTING)) {
    const items = entry.record.groupedItems;
    const structure = entry.record.structure ?? 'simple';
    if (items && structure !== 'grouped') {
      report('INV11', entry, `groupedItems is set but structure is '${structure}'; a listing that bundles others is 'grouped'`);
    }
    if (!items && structure === 'grouped') {
      report('INV11', entry, `structure is 'grouped' but groupedItems is absent, so nothing says what is grouped`);
    }
    (items ?? []).forEach((item, i) => {
      if (item.item === entry.uri) {
        report('INV11', entry, `groupedItems/${i} points at this listing itself`);
      }
    });
  }

  // INV12 — a group's default variant must be one of its own variants.
  for (const entry of of(PRODUCT_GROUP)) {
    const target = entry.record.defaultVariant;
    if (!target) continue;
    const listing = byUri.get(target);
    if (listing?.nsid !== LISTING) continue; // a missing or mistyped target is INV6's report
    if (listing.record.partOf !== entry.uri) {
      report('INV12', entry, `defaultVariant ${target} has partOf ${listing.record.partOf ?? '(none)'}, so it is not a variant of this group`);
    }
  }

  // INV13 — a license must state its terms somewhere.
  for (const entry of of(LICENSE)) {
    if (!entry.record.content && !entry.record.url && !entry.record.identifier) {
      report('INV13', entry, `license has no content, url, or identifier, so nothing states the terms it grants`);
    }
  }

  return violations;
}

/** Resolve a field through group inheritance, the way a consumer must. */
export function resolveField(entry, field, byUri) {
  if (entry.record[field] !== undefined) return entry.record[field];
  if (!INHERITED.includes(field)) return undefined;
  const group = entry.record.partOf ? byUri.get(entry.record.partOf) : null;
  return group?.record?.[field];
}
