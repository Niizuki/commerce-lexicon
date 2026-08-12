// Static, schema-level checks that the reference validator does not perform.
//
// @atproto/lexicon resolves refs lazily: `Lexicons.add()` only rewrites ref
// strings to absolute URIs, and a target def is looked up at validation time.
// A ref to a def that does not exist therefore registers cleanly and is only
// caught if some fixture happens to exercise that branch. These checks close
// that gap and make fixture coverage of the schema explicit.

const PROJECT_PREFIX = 'app.temp.commerce.';
const NON_REFERENCEABLE = new Set(['record', 'query', 'procedure', 'subscription']);

/** Map of nsid -> lexicon doc, for our own resolution (independent of Lexicons internals). */
export function indexDocs(docs) {
  const index = new Map();
  for (const doc of docs) index.set(doc.id, doc);
  return index;
}

/** "#foo" | "nsid#foo" | "nsid" -> "nsid#foo" (bare nsid means its #main def). */
export function normalizeRef(ref, currentNsid) {
  if (ref.startsWith('#')) return `${currentNsid}${ref}`;
  return ref.includes('#') ? ref : `${ref}#main`;
}

export function resolveDef(index, uri) {
  const [nsid, defName] = uri.split('#');
  const def = index.get(nsid)?.defs?.[defName];
  return def ? { nsid, defName, def } : null;
}

/** Every ref/union member in every lexicon must point at a def that exists and is referenceable. */
export function checkRefIntegrity(index) {
  const errors = [];
  for (const [nsid, doc] of index) {
    walkSchema(doc.defs, (node, path) => {
      const refs =
        node.type === 'ref' ? [node.ref] : node.type === 'union' ? node.refs ?? [] : [];
      for (const ref of refs) {
        const uri = normalizeRef(ref, nsid);
        const target = resolveDef(index, uri);
        if (!target) {
          errors.push(`${nsid}${path} -> ${ref} does not resolve (no such def: ${uri})`);
        } else if (NON_REFERENCEABLE.has(target.def.type)) {
          errors.push(`${nsid}${path} -> ${ref} points at a '${target.def.type}' def, which cannot be referenced`);
        }
      }
    });
  }
  return errors;
}

function walkSchema(node, visit, path = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkSchema(item, visit, `${path}/${i}`));
    return;
  }
  if (typeof node.type === 'string') visit(node, path);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'type' || key === 'ref' || key === 'refs') continue;
    walkSchema(child, visit, `${path}/${key}`);
  }
}

/**
 * Walk a record against its schema, reporting properties the schema does not declare
 * and collecting which defs the record exercised.
 *
 * The reference validator ignores unknown properties, so a typo'd field name or a
 * field left over from an earlier schema version passes validation silently. This
 * is the check that catches those.
 */
export function walkRecord(index, record, touched = new Set(), opts = {}) {
  const errors = [];
  const nsid = String(record.$type ?? '').split('#')[0];
  const target = resolveDef(index, `${nsid}#main`);
  if (!target) return { errors: [`unknown record type: ${record.$type}`], touched };
  touched.add(`${nsid}#main`);
  walkNode(target.def, record, nsid, '', { index, errors, touched, ...opts });
  return { errors, touched };
}

function walkNode(node, value, nsid, path, ctx) {
  if (value === undefined || value === null) return;
  switch (node.type) {
    case 'record':
      return walkNode(node.record, value, nsid, path, ctx);

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return; // shape errors are the schema validator's job
      const properties = node.properties ?? {};
      for (const key of Object.keys(value)) {
        if (key === '$type') continue;
        const child = properties[key];
        if (!child) {
          ctx.errors.push(`${path}/${key} is not declared in the schema`);
          continue;
        }
        walkNode(child, value[key], nsid, `${path}/${key}`, ctx);
      }
      return;
    }

    case 'array':
      if (!Array.isArray(value)) return;
      value.forEach((item, i) => walkNode(node.items, item, nsid, `${path}/${i}`, ctx));
      return;

    case 'ref': {
      const uri = normalizeRef(node.ref, nsid);
      ctx.touched.add(uri);
      const target = resolveDef(ctx.index, uri);
      if (target) walkNode(target.def, value, target.nsid, path, ctx);
      return;
    }

    case 'union': {
      if (typeof value !== 'object' || Array.isArray(value)) return;
      const declared = (node.refs ?? []).map((ref) => normalizeRef(ref, nsid));
      if (typeof value.$type !== 'string') return; // missing $type is reported by the schema validator
      const uri = normalizeRef(value.$type, nsid);
      if (!declared.includes(uri)) {
        // Lexicon unions are open: an unknown member is protocol-valid and is how
        // new mechanisms arrive. Our own fixtures should still only use declared
        // members, so this is an error unless a corpus opts out of the rule.
        if (!ctx.allowUndeclaredUnionMembers) {
          ctx.errors.push(
            `${path} has $type ${value.$type}, which is not one of the union's declared refs (${declared.join(', ')})`,
          );
        }
        return;
      }
      ctx.touched.add(uri);
      const target = resolveDef(ctx.index, uri);
      if (target) walkNode(target.def, value, target.nsid, path, ctx);
      return;
    }

    default:
      return; // primitives and blobs carry nothing further to walk
  }
}

/** Every def in the project's own lexicons must be exercised by at least one fixture. */
export function checkCoverage(index, touched) {
  const missing = [];
  for (const [nsid, doc] of index) {
    if (!nsid.startsWith(PROJECT_PREFIX)) continue; // vendored lexicons are upstream's to cover
    for (const defName of Object.keys(doc.defs)) {
      const uri = `${nsid}#${defName}`;
      if (!touched.has(uri)) missing.push(uri);
    }
  }
  return missing;
}
