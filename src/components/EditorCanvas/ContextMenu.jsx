// Quick actions on what was right-clicked: a table (and the column under the
// pointer), a relationship, a note, an area, or the empty canvas.

import { useEffect } from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import {
  IconCopyStroked,
  IconDeleteStroked,
  IconEditStroked,
  IconCopyAdd,
  IconPlus,
  IconRefresh,
} from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { ObjectType } from "../../data/constants";
import {
  useAreas,
  useDiagram,
  useElementActions,
  useLayout,
  useNotes,
} from "../../hooks";

/**
 * @param {{ menu: null | {
 *   x: number, y: number,            // screen position
 *   at: { x: number, y: number },    // diagram position
 *   target: null | { element: number, id: any, fieldId?: any },
 * }, onClose: () => void }} props
 */
export default function ContextMenu({ menu, onClose }) {
  const { t } = useTranslation();
  const { layout } = useLayout();
  const { tables, relationships, addTable } = useDiagram();
  const { notes, addNote } = useNotes();
  const { areas, addArea } = useAreas();
  const actions = useElementActions();

  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (e.type !== "keydown" || e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const editable = !layout.readOnly;
  const item = (key, label, run, { icon, danger = false } = {}) => (
    <Dropdown.Item
      key={key}
      icon={icon}
      type={danger ? "danger" : undefined}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {label}
    </Dropdown.Item>
  );
  const title = (key, text) => (
    <Dropdown.Title key={key}>
      <span className="block max-w-56 truncate">{text}</span>
    </Dropdown.Title>
  );

  const target = menu.target;
  const items = [];
  // Edit, duplicate, copy and delete, for what has them.
  const common = (element, id, { duplicate = true } = {}) => {
    const self = { element, id };
    items.push(
      item(`edit-${element}`, t("edit"), () => actions.edit(self), {
        icon: <IconEditStroked />,
      }),
    );
    if (editable && duplicate) {
      items.push(
        item(
          `duplicate-${element}`,
          t("duplicate"),
          () => actions.duplicate(self),
          { icon: <IconCopyStroked /> },
        ),
      );
    }
    if (duplicate) {
      items.push(
        item(`copy-${element}`, t("copy"), () => actions.copy(self), {
          icon: <IconCopyStroked />,
        }),
      );
    }
  };

  if (!target) {
    if (editable) {
      items.push(
        item("add-table", t("add_table"), () => addTable(null, true, menu.at), {
          icon: <IconPlus />,
        }),
        item("add-note", t("add_note"), () => addNote(null, true, menu.at), {
          icon: <IconPlus />,
        }),
        item("add-area", t("add_area"), () => addArea(null, true, menu.at), {
          icon: <IconPlus />,
        }),
        <Dropdown.Divider key="divider-paste" />,
        item("paste", t("paste"), () => actions.paste(menu.at), {
          icon: <IconCopyAdd />,
        }),
      );
    }
  } else if (target.element === ObjectType.TABLE) {
    const table = tables.find((tb) => tb.id === target.id);
    if (!table) return null;
    const field = table.fields.find((f) => f.id === target.fieldId);
    if (field && editable) {
      items.push(
        title("field-title", `${table.name}.${field.name}`),
        item(
          "delete-field",
          t("delete_field"),
          () => actions.removeField(field, table.id),
          { icon: <IconDeleteStroked />, danger: true },
        ),
        <Dropdown.Divider key="divider-field" />,
      );
    }
    items.push(title("table-title", table.name));
    common(ObjectType.TABLE, table.id);
    if (editable) {
      items.push(
        <Dropdown.Divider key="divider-table" />,
        item(
          "delete-table",
          t("delete_table_item"),
          () => actions.removeTable(table.id),
          { icon: <IconDeleteStroked />, danger: true },
        ),
      );
    }
  } else if (target.element === ObjectType.RELATIONSHIP) {
    const relationship = relationships.find((r) => r.id === target.id);
    if (!relationship) return null;
    items.push(title("relationship-title", relationship.name));
    common(ObjectType.RELATIONSHIP, relationship.id, { duplicate: false });
    if (editable && Number.isFinite(relationship.bendOffset)) {
      items.push(
        item(
          "reset-route",
          t("reset_route"),
          () => actions.resetRoute(relationship.id),
          { icon: <IconRefresh /> },
        ),
      );
    }
    if (editable) {
      items.push(
        <Dropdown.Divider key="divider-relationship" />,
        item("delete-relationship", t("delete"), () => actions.remove(target), {
          icon: <IconDeleteStroked />,
          danger: true,
        }),
      );
    }
  } else if (
    target.element === ObjectType.NOTE ||
    target.element === ObjectType.AREA
  ) {
    const object = (target.element === ObjectType.NOTE ? notes : areas)[
      target.id
    ];
    if (!object) return null;
    items.push(title("object-title", object.title ?? object.name));
    common(target.element, target.id);
    if (editable) {
      items.push(
        <Dropdown.Divider key="divider-object" />,
        item("delete-object", t("delete"), () => actions.remove(target), {
          icon: <IconDeleteStroked />,
          danger: true,
        }),
      );
    }
  }

  if (!items.length) return null;

  return (
    <Dropdown
      trigger="custom"
      visible
      position="bottomLeft"
      onClickOutSide={onClose}
      render={
        <Dropdown.Menu data-testid="canvas-context-menu">{items}</Dropdown.Menu>
      }
    >
      <div
        className="fixed w-px h-px pointer-events-none"
        style={{ left: menu.x, top: menu.y }}
      />
    </Dropdown>
  );
}
