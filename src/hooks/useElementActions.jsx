// Actions on the objects of the canvas, shared by the keyboard shortcuts, the
// context menu, the canvas itself and the side panel, so they all behave the
// same: deleting a table or a column that relationships depend on asks first
// and names what goes with it.

import { Modal, Toast } from "@douyinfe/semi-ui";
import { Validator } from "jsonschema";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import { Action, ObjectType, Tab } from "../data/constants";
import { areaSchema, noteSchema, tableSchema } from "../data/schemas";
import { getRelationshipFields } from "../utils/utils";
import useAreas from "./useAreas";
import useDiagram from "./useDiagram";
import useLayout from "./useLayout";
import useNotes from "./useNotes";
import useSelect from "./useSelect";
import useUndoRedo from "./useUndoRedo";

export default function useElementActions() {
  const { t } = useTranslation();
  const { layout } = useLayout();
  const {
    tables,
    relationships,
    addTable,
    deleteTable,
    deleteField,
    deleteRelationship,
    updateRelationship,
  } = useDiagram();
  const { notes, addNote, deleteNote } = useNotes();
  const { areas, addArea, deleteArea } = useAreas();
  const { selectedElement, setSelectedElement } = useSelect();
  const { setUndoStack, setRedoStack } = useUndoRedo();

  const byId = (list, id) => list.find((item) => item.id === id);

  const tableDependencies = (tableId) =>
    relationships.filter(
      (r) => r.startTableId === tableId || r.endTableId === tableId,
    );

  const fieldDependencies = (field, tableId) =>
    relationships.filter((r) =>
      getRelationshipFields(r).some(
        (p) =>
          (r.startTableId === tableId && p.startFieldId === field.id) ||
          (r.endTableId === tableId && p.endFieldId === field.id),
      ),
    );

  // "fk_orders_customer: orders(customer_id) → customers(id)"
  const describe = (r) => {
    const start = byId(tables, r.startTableId);
    const end = byId(tables, r.endTableId);
    const column = (table, id) =>
      table?.fields.find((f) => f.id === id)?.name ?? "?";
    const pairs = getRelationshipFields(r);
    return `${r.name}: ${start?.name ?? "?"}(${pairs
      .map((p) => column(start, p.startFieldId))
      .join(", ")}) → ${end?.name ?? "?"}(${pairs
      .map((p) => column(end, p.endFieldId))
      .join(", ")})`;
  };

  // Runs `onOk` at once, or once the user confirms when relationships would
  // go with what is deleted.
  const confirmIfNeeded = (title, dependencies, onOk) => {
    if (!dependencies.length) {
      onOk();
      return;
    }
    Modal.confirm({
      title,
      content: (
        <div data-testid="delete-dependencies">
          <p className="mb-2">
            {t("delete_dependencies", { count: dependencies.length })}
          </p>
          <ul className="list-disc ps-5 max-h-48 overflow-auto font-mono text-xs">
            {dependencies.map((r) => (
              <li key={r.id}>{describe(r)}</li>
            ))}
          </ul>
        </div>
      ),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { type: "danger" },
      onOk,
    });
  };

  // `run` wraps the deletion (the canvas takes the collaboration lock first).
  const removeTable = (tableId, { run = (action) => action() } = {}) => {
    if (layout.readOnly) return;
    const table = byId(tables, tableId);
    if (!table) return;
    confirmIfNeeded(
      t("delete_table_confirm", { name: table.name }),
      tableDependencies(tableId),
      () => run(() => deleteTable(tableId)),
    );
  };

  const removeField = (field, tableId, { run = (action) => action() } = {}) => {
    if (layout.readOnly) return;
    confirmIfNeeded(
      t("delete_field_confirm", { name: field.name }),
      fieldDependencies(field, tableId),
      () => run(() => deleteField(field, tableId)),
    );
  };

  const remove = ({ element, id }) => {
    if (layout.readOnly) return;
    switch (element) {
      case ObjectType.TABLE:
        removeTable(id);
        break;
      case ObjectType.RELATIONSHIP:
        if (byId(relationships, id)) deleteRelationship(id);
        break;
      case ObjectType.NOTE:
        if (notes[id]) deleteNote(id);
        break;
      case ObjectType.AREA:
        if (areas[id]) deleteArea(id);
        break;
      default:
        break;
    }
  };

  /** Deletes several objects (a rubber-band selection) after one question. */
  const removeMany = (elements) => {
    if (layout.readOnly || !elements.length) return;
    if (elements.length === 1) {
      remove({ element: elements[0].type, id: elements[0].id });
      return;
    }
    const tableIds = elements
      .filter((el) => el.type === ObjectType.TABLE)
      .map((el) => el.id);
    const dependencies = relationships.filter(
      (r) =>
        tableIds.includes(r.startTableId) || tableIds.includes(r.endTableId),
    );
    // Notes and areas are numbered by position: the last ones go first.
    const descending = (type) =>
      elements
        .filter((el) => el.type === type)
        .map((el) => el.id)
        .sort((a, b) => b - a);
    confirmIfNeeded(
      t("delete_selection_confirm", { count: elements.length }),
      dependencies,
      () => {
        tableIds.forEach((id) => deleteTable(id));
        descending(ObjectType.NOTE).forEach((id) => deleteNote(id));
        descending(ObjectType.AREA).forEach((id) => deleteArea(id));
      },
    );
  };

  const edit = ({ element, id }) => {
    const tabs = {
      [ObjectType.TABLE]: [Tab.TABLES, `scroll_table_${id}`],
      [ObjectType.RELATIONSHIP]: [Tab.RELATIONSHIPS, `scroll_ref_${id}`],
      [ObjectType.NOTE]: [Tab.NOTES, `scroll_note_${id}`],
      [ObjectType.AREA]: [Tab.AREAS, `scroll_area_${id}`],
    };
    if (!tabs[element]) return;
    const [tab, scrollId] = tabs[element];
    setSelectedElement((prev) => ({
      ...prev,
      element,
      id,
      open: true,
      ...(layout.sidebar && { currentTab: tab }),
      // Notes and areas open a popover that a click outside would close.
      ...(!layout.sidebar && { editFromToolbar: true }),
    }));
    if (layout.sidebar && selectedElement.currentTab === tab) {
      window.setTimeout(() =>
        document
          .getElementById(scrollId)
          ?.scrollIntoView({ behavior: "smooth" }),
      );
    }
  };

  const duplicate = ({ element, id }) => {
    if (layout.readOnly) return;
    switch (element) {
      case ObjectType.TABLE: {
        const table = byId(tables, id);
        if (!table) return;
        addTable({
          table: {
            ...table,
            id: nanoid(),
            name: `${table.name}_copy`,
            x: table.x + 24,
            y: table.y + 24,
            locked: false,
            fields: table.fields.map((f) => ({ ...f, id: nanoid() })),
            indices: (table.indices ?? []).map((index) => ({ ...index })),
          },
        });
        break;
      }
      case ObjectType.NOTE:
        if (!notes[id]) return;
        addNote({
          ...notes[id],
          x: notes[id].x + 20,
          y: notes[id].y + 20,
          locked: false,
          id: notes.length,
        });
        break;
      case ObjectType.AREA:
        if (!areas[id]) return;
        addArea({
          ...areas[id],
          x: areas[id].x + 20,
          y: areas[id].y + 20,
          locked: false,
          id: areas.length,
        });
        break;
      default:
        break;
    }
  };

  const copy = ({ element, id }) => {
    const object =
      element === ObjectType.TABLE
        ? byId(tables, id)
        : element === ObjectType.NOTE
          ? notes[id]
          : element === ObjectType.AREA
            ? areas[id]
            : null;
    if (!object) return;
    navigator.clipboard
      .writeText(JSON.stringify(object))
      .catch(() => Toast.error(t("oops_smth_went_wrong")));
  };

  /** Pastes a copied table, area or note, next to it or at `at`. */
  const paste = (at = null) => {
    if (layout.readOnly) return;
    navigator.clipboard
      .readText()
      .then((text) => {
        let object;
        try {
          object = JSON.parse(text);
        } catch {
          return;
        }
        if (!object || typeof object !== "object") return;
        const position = at ?? { x: object.x + 20, y: object.y + 20 };
        const v = new Validator();
        if (v.validate(object, tableSchema).valid) {
          addTable({
            table: {
              ...object,
              ...position,
              id: nanoid(),
              fields: object.fields.map((f) => ({ ...f, id: nanoid() })),
            },
          });
        } else if (v.validate(object, areaSchema).valid) {
          addArea({ ...object, ...position, id: areas.length });
        } else if (v.validate(object, noteSchema).valid) {
          addNote({ ...object, ...position, id: notes.length });
        }
      })
      .catch(() => Toast.error(t("oops_smth_went_wrong")));
  };

  /** Puts a relationship's line back on its automatic route. */
  const resetRoute = (id) => {
    if (layout.readOnly) return;
    const relationship = byId(relationships, id);
    if (!Number.isFinite(relationship?.bendOffset)) return;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: id,
        undo: { bendOffset: relationship.bendOffset },
        redo: { bendOffset: null },
        message: t("edit_relationship", {
          refName: relationship.name,
          extra: "[route]",
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(id, { bendOffset: null });
  };

  return {
    tableDependencies,
    fieldDependencies,
    removeTable,
    removeField,
    remove,
    removeMany,
    edit,
    duplicate,
    copy,
    paste,
    resetRoute,
  };
}
