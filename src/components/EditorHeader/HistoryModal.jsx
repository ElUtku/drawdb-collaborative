import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Input,
  Modal,
  Popconfirm,
  Spin,
  TabPane,
  Tabs,
  Tag,
  Toast,
} from "@douyinfe/semi-ui";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { diagramApi } from "../../api/diagrams";
import { diffDiagrams } from "../../utils/schemaDiff";
import ActivityList from "../ActivityList";

const LABEL_COLORS = {
  created: "green",
  named: "violet",
  restored: "orange",
  before_change: "grey",
  git_pull: "cyan",
};

function ChangeList({ title, items, color }) {
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <div className="text-xs font-medium text-zinc-500">{title}</div>
      <ul className="text-sm">
        {items.map((item, i) => (
          <li key={i} className={color}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Changes({ diff }) {
  const { t } = useTranslation();
  if (diff.empty) {
    return <div className="text-sm text-zinc-500">{t("history_same")}</div>;
  }
  const fieldLine = (field) => {
    const name =
      field.from !== field.name ? `${field.from} → ${field.name}` : field.name;
    const props = field.props
      .map(
        (prop) =>
          `${prop}: ${JSON.stringify(field.before[prop] ?? "")} → ${JSON.stringify(field.after[prop] ?? "")}`,
      )
      .join(", ");
    return props ? `${name} (${props})` : name;
  };
  return (
    <div>
      <ChangeList
        title={t("history_tables_added")}
        items={diff.tables.added}
        color="text-emerald-600"
      />
      <ChangeList
        title={t("history_tables_removed")}
        items={diff.tables.removed}
        color="text-red-600"
      />
      {diff.tables.changed.map((table) => (
        <div key={table.name} className="mb-2">
          <div className="text-xs font-medium text-zinc-500">
            {t("history_table_changed")}:{" "}
            {table.from !== table.name
              ? `${table.from} → ${table.name}`
              : table.name}
          </div>
          <ul className="text-sm ms-3">
            {table.addedFields.map((name) => (
              <li key={`+${name}`} className="text-emerald-600">
                + {name}
              </li>
            ))}
            {table.removedFields.map((name) => (
              <li key={`-${name}`} className="text-red-600">
                − {name}
              </li>
            ))}
            {table.changedFields.map((field) => (
              <li key={`~${field.name}`} className="text-amber-600">
                ~ {fieldLine(field)}
              </li>
            ))}
            {table.indexes && (
              <li className="text-amber-600">~ {t("history_indexes")}</li>
            )}
            {table.comment && (
              <li className="text-amber-600">~ {t("comment")}</li>
            )}
          </ul>
        </div>
      ))}
      <ChangeList
        title={t("history_relationships_added")}
        items={diff.relationships.added}
        color="text-emerald-600"
      />
      <ChangeList
        title={t("history_relationships_removed")}
        items={diff.relationships.removed}
        color="text-red-600"
      />
      <ChangeList
        title={t("history_relationships_changed")}
        items={diff.relationships.changed}
        color="text-amber-600"
      />
      <ChangeList
        title={t("enums")}
        items={[
          ...diff.enums.added.map((n) => `+ ${n}`),
          ...diff.enums.removed.map((n) => `− ${n}`),
          ...diff.enums.changed.map((n) => `~ ${n}`),
        ]}
      />
      <ChangeList
        title={t("types")}
        items={[
          ...diff.types.added.map((n) => `+ ${n}`),
          ...diff.types.removed.map((n) => `− ${n}`),
          ...diff.types.changed.map((n) => `~ ${n}`),
        ]}
      />
    </div>
  );
}

// Saved versions of a diagram: what changed since each one, going back to
// it, and the ALTER script from it to the diagram as it is now.
export default function HistoryModal({
  open,
  onClose,
  diagramId,
  role,
  currentName,
  currentDocument,
  onRestored,
  onMigration,
}) {
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activity, setActivity] = useState(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("versions");
  const canEdit = role === "owner" || role === "editor";

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await diagramApi.versions(diagramId);
      setVersions(result.versions);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [diagramId]);

  useEffect(() => {
    if (!open || !diagramId) return;
    load();
    setTab("versions");
    return () => {
      setVersions(null);
      setSelected(null);
      setDetail(null);
      setActivity(null);
    };
  }, [open, diagramId, load]);

  useEffect(() => {
    if (!open || tab !== "activity" || role !== "owner") return;
    diagramApi
      .activity(diagramId)
      .then((result) => setActivity(result.entries))
      .catch((loadError) => setError(loadError.message));
  }, [open, tab, role, diagramId]);

  useEffect(() => {
    if (selected === null) return;
    let active = true;
    setDetail(null);
    diagramApi
      .version(diagramId, selected)
      .then((found) => active && setDetail(found))
      .catch((loadError) => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, [selected, diagramId]);

  const diff = useMemo(
    () => (detail ? diffDiagrams(detail.document, currentDocument) : null),
    [detail, currentDocument],
  );

  const date = (iso) =>
    DateTime.fromISO(iso)
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATETIME_MED);
  const label = (version) =>
    version.title ||
    (version.label
      ? t(`history_label_${version.label}`, { defaultValue: version.label })
      : t("history_autosave"));

  const nameVersion = async () => {
    setBusy(true);
    try {
      await diagramApi.nameVersion(diagramId, title.trim());
      setTitle("");
      Toast.success(t("version_named"));
      await load();
    } catch (nameError) {
      setError(nameError.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const diagram = await diagramApi.restore(diagramId, selected);
      onRestored?.(diagram);
      Toast.success(t("version_restored", { version: selected }));
      setSelected(null);
      await load();
    } catch (restoreError) {
      setError(restoreError.message);
    } finally {
      setBusy(false);
    }
  };

  const versionList = () => {
    if (!versions) {
      return (
        <div className="py-8 text-center">
          <Spin />
        </div>
      );
    }
    if (!versions.length) {
      return (
        <div className="text-sm text-zinc-500 p-3">{t("history_empty")}</div>
      );
    }
    return (
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {versions.map((version) => (
          <li key={version.version}>
            <button
              type="button"
              data-testid={`version-${version.version}`}
              onClick={() => setSelected(version.version)}
              className={`w-full text-start px-3 py-2 hover-1 ${
                selected === version.version
                  ? "bg-sky-100 dark:bg-sky-900/40"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">
                  v{version.version} · {label(version)}
                </span>
                {version.label && (
                  <Tag
                    size="small"
                    color={LABEL_COLORS[version.label] ?? "grey"}
                  >
                    {t(`history_tag_${version.label}`, {
                      defaultValue: version.label,
                    })}
                  </Tag>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                {date(version.createdAt)}
                {version.username ? ` · ${version.username}` : ""}
                {version.editors?.length
                  ? ` · ${t("history_edited_by", { names: version.editors.join(", ") })}`
                  : ""}
              </div>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const details = () => {
    if (selected === null) {
      return (
        <div className="text-sm text-zinc-500 p-4">{t("history_pick")}</div>
      );
    }
    if (!detail) {
      return (
        <div className="py-8 text-center">
          <Spin />
        </div>
      );
    }
    return (
      <div className="p-3">
        <div className="font-medium">
          v{detail.version} · {detail.name}
        </div>
        <div className="text-xs text-zinc-500 mb-3">
          {date(detail.createdAt)}
        </div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
          {t("history_changes_since", { name: currentName })}
        </div>
        <div className="max-h-64 overflow-auto mb-3">
          {diff && <Changes diff={diff} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Popconfirm
              title={t("restore_version")}
              content={t("history_restore_confirm", {
                version: detail.version,
              })}
              onConfirm={restore}
            >
              <Button type="warning" disabled={busy}>
                {t("restore_version")}
              </Button>
            </Popconfirm>
          )}
          <Button
            disabled={!diff || diff.empty}
            onClick={() =>
              onMigration?.(detail.document, {
                from: `v${detail.version} · ${label(detail)} (${date(detail.createdAt)})`,
              })
            }
          >
            {t("history_migration")}
          </Button>
        </div>
        <div className="text-xs text-zinc-500 mt-2">
          {t("history_migration_desc")}
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={t("version_history")}
      visible={open}
      onCancel={onClose}
      footer={null}
      centered
      width={880}
      bodyStyle={{ paddingBottom: 24 }}
    >
      {error && (
        <Banner
          type="danger"
          description={error}
          className="mb-3"
          onClose={() => setError("")}
        />
      )}
      <Tabs activeKey={tab} onChange={setTab} type="line">
        <TabPane tab={t("versions")} itemKey="versions">
          {canEdit && (
            <div className="flex gap-2 my-3">
              <Input
                placeholder={t("version_name_placeholder")}
                value={title}
                maxLength={120}
                onChange={setTitle}
              />
              <Button
                theme="solid"
                disabled={!title.trim() || busy}
                onClick={nameVersion}
              >
                {t("name_version")}
              </Button>
            </div>
          )}
          <div className="flex gap-3 min-h-80">
            <div className="w-80 shrink-0 border border-color rounded-sm max-h-[28rem] overflow-auto">
              {versionList()}
            </div>
            <div className="flex-1 min-w-0 border border-color rounded-sm">
              {details()}
            </div>
          </div>
        </TabPane>
        {role === "owner" && (
          <TabPane tab={t("activity")} itemKey="activity">
            <div className="max-h-[32rem] overflow-auto pt-2">
              {activity ? (
                <ActivityList entries={activity} />
              ) : (
                <div className="py-8 text-center">
                  <Spin />
                </div>
              )}
            </div>
          </TabPane>
        )}
      </Tabs>
    </Modal>
  );
}
