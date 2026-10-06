// What changed between two versions of a diagram, in terms people read:
// tables and columns added, removed, renamed or changed, and relationships.
// Items are matched by id, then by name (a diagram imported again gets new ids).

const FIELD_PROPS = [
  "type",
  "size",
  "primary",
  "unique",
  "notNull",
  "increment",
  "default",
  "check",
  "comment",
  "unsigned",
  "isArray",
  "values",
];

const key = (name) => String(name ?? "").toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Empty text and a missing value mean the same.
const normalize = (value) =>
  value === "" || value === undefined || value === false ? null : value;

function pair(before = [], after = []) {
  const pairs = [];
  const used = new Set();
  const rest = [];
  for (const item of after) {
    const match = before.find(
      (b) => !used.has(b) && b.id !== undefined && b.id === item.id,
    );
    if (match) {
      pairs.push([match, item]);
      used.add(match);
    } else rest.push(item);
  }
  const added = [];
  for (const item of rest) {
    const match = before.find(
      (b) => !used.has(b) && key(b.name) === key(item.name),
    );
    if (match) {
      pairs.push([match, item]);
      used.add(match);
    } else added.push(item);
  }
  return { pairs, added, removed: before.filter((b) => !used.has(b)) };
}

function relationshipKey(relationship, tableName, fieldName) {
  const fields = relationship.fields?.length
    ? relationship.fields
    : [
        {
          startFieldId: relationship.startFieldId,
          endFieldId: relationship.endFieldId,
        },
      ];
  return `${tableName(relationship.startTableId)}(${fields
    .map((f) => fieldName(relationship.startTableId, f.startFieldId))
    .join(", ")}) → ${tableName(relationship.endTableId)}(${fields
    .map((f) => fieldName(relationship.endTableId, f.endFieldId))
    .join(", ")})`;
}

export function diffDiagrams(before = {}, after = {}) {
  const tables = pair(before.tables, after.tables);
  const changedTables = [];
  for (const [old, now] of tables.pairs) {
    const fields = pair(old.fields, now.fields);
    const changedFields = [];
    for (const [o, n] of fields.pairs) {
      const props = FIELD_PROPS.filter(
        (prop) => !same(normalize(o[prop]), normalize(n[prop])),
      );
      if (o.name !== n.name || props.length) {
        changedFields.push({
          from: o.name,
          name: n.name,
          props,
          before: Object.fromEntries(props.map((p) => [p, o[p]])),
          after: Object.fromEntries(props.map((p) => [p, n[p]])),
        });
      }
    }
    const indexes =
      !same(old.indices ?? [], now.indices ?? []) ||
      !same(old.uniqueConstraints ?? [], now.uniqueConstraints ?? []);
    const comment = normalize(old.comment) !== normalize(now.comment);
    if (
      old.name !== now.name ||
      fields.added.length ||
      fields.removed.length ||
      changedFields.length ||
      indexes ||
      comment
    ) {
      changedTables.push({
        from: old.name,
        name: now.name,
        addedFields: fields.added.map((f) => f.name),
        removedFields: fields.removed.map((f) => f.name),
        changedFields,
        indexes,
        comment,
      });
    }
  }

  const describe = (doc) => {
    const byId = new Map((doc.tables ?? []).map((t) => [t.id, t]));
    const tableName = (id) => byId.get(id)?.name ?? "?";
    const fieldName = (tableId, fieldId) =>
      byId.get(tableId)?.fields?.find((f) => f.id === fieldId)?.name ?? "?";
    return (doc.references ?? doc.relationships ?? []).map((r) => ({
      label: relationshipKey(r, tableName, fieldName),
      actions: `${r.deleteConstraint ?? ""}/${r.updateConstraint ?? ""}`,
    }));
  };
  const beforeRefs = describe(before);
  const afterRefs = describe(after);
  const labels = (list) => new Map(list.map((r) => [r.label, r]));
  const beforeMap = labels(beforeRefs);
  const afterMap = labels(afterRefs);
  const relationships = {
    added: afterRefs.filter((r) => !beforeMap.has(r.label)).map((r) => r.label),
    removed: beforeRefs
      .filter((r) => !afterMap.has(r.label))
      .map((r) => r.label),
    changed: afterRefs
      .filter(
        (r) =>
          beforeMap.has(r.label) &&
          beforeMap.get(r.label).actions !== r.actions,
      )
      .map((r) => r.label),
  };

  const enums = pair(before.enums, after.enums);
  const types = pair(before.types, after.types);
  const changedEnums = enums.pairs
    .filter(([o, n]) => o.name !== n.name || !same(o.values, n.values))
    .map(([, n]) => n.name);
  const changedTypes = types.pairs
    .filter(([o, n]) => o.name !== n.name || !same(o.fields, n.fields))
    .map(([, n]) => n.name);

  const result = {
    tables: {
      added: tables.added.map((t) => t.name),
      removed: tables.removed.map((t) => t.name),
      changed: changedTables,
    },
    relationships,
    enums: {
      added: enums.added.map((e) => e.name),
      removed: enums.removed.map((e) => e.name),
      changed: changedEnums,
    },
    types: {
      added: types.added.map((e) => e.name),
      removed: types.removed.map((e) => e.name),
      changed: changedTypes,
    },
    notes:
      (after.notes?.length ?? 0) - (before.notes?.length ?? 0) ||
      !same(before.notes ?? [], after.notes ?? []),
  };
  result.empty =
    !result.tables.added.length &&
    !result.tables.removed.length &&
    !result.tables.changed.length &&
    !relationships.added.length &&
    !relationships.removed.length &&
    !relationships.changed.length &&
    !result.enums.added.length &&
    !result.enums.removed.length &&
    !result.enums.changed.length &&
    !result.types.added.length &&
    !result.types.removed.length &&
    !result.types.changed.length;
  return result;
}
