import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  TabPane,
  Tabs,
  Tag,
  Toast,
} from "@douyinfe/semi-ui";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { adminApi } from "../../api/auth";
import { useAuth } from "../../hooks";
import ActivityList from "../ActivityList";

const AUDIT_ACTIONS = [
  "auth.setup",
  "auth.signup",
  "auth.login",
  "auth.login_failed",
  "auth.login_disabled",
  "auth.logout",
  "auth.password_changed",
  "user.created",
  "user.password_reset",
  "user.disabled",
  "user.enabled",
  "user.deleted",
  "diagram.created",
  "diagram.edited",
  "diagram.renamed",
  "diagram.deleted",
  "diagram.restored",
  "diagram.version_named",
  "diagram.member_set",
  "diagram.member_removed",
  "diagram.link_access",
  "diagram.owner_changed",
  "git.configured",
  "git.disconnected",
  "git.pushed",
  "git.pulled",
  "types.changed",
  "backup.created",
  "backup.downloaded",
];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function UsersTab({ users, setUsers, setError }) {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState({ id: null, panel: null });
  const [resetValue, setResetValue] = useState("");
  const [transferTo, setTransferTo] = useState(null);

  const toggle = (id, panel) => {
    setOpen((current) =>
      current.id === id && current.panel === panel
        ? { id: null, panel: null }
        : { id, panel },
    );
    setResetValue("");
    setTransferTo(me?.id ?? null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const created = await adminApi.createUser({
        username: username.trim(),
        password,
      });
      setUsers((current) => [...current, created]);
      setUsername("");
      setPassword("");
      Toast.success(t("user_created", { username: created.username }));
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (user) => {
    setError("");
    try {
      await adminApi.resetPassword(user.id, resetValue);
      Toast.success(t("password_reset_done", { username: user.username }));
      toggle(null, null);
    } catch (resetError) {
      setError(resetError.message);
    }
  };

  const setDisabled = async (user, disabled) => {
    setError("");
    try {
      const updated = await adminApi.setDisabled(user.id, disabled);
      setUsers((current) =>
        current.map((u) => (u.id === updated.id ? updated : u)),
      );
      Toast.success(
        t(disabled ? "user_disabled_done" : "user_enabled_done", {
          username: user.username,
        }),
      );
    } catch (disableError) {
      setError(disableError.message);
    }
  };

  const deleteUser = async (user) => {
    setError("");
    try {
      const result = await adminApi.deleteUser(user.id, transferTo);
      setUsers((current) => current.filter((u) => u.id !== user.id));
      Toast.success(
        t("user_deleted_done", {
          username: user.username,
          count: result.transferred,
        }),
      );
      toggle(null, null);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const date = (iso) =>
    iso
      ? DateTime.fromISO(iso).setLocale(i18n.language).toRelative()
      : t("never");

  return (
    <>
      <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-36">
          <label className="text-sm font-medium" htmlFor="admin-username">
            {t("username")}
          </label>
          <Input
            id="admin-username"
            value={username}
            onChange={setUsername}
            autoComplete="off"
            className="mt-1"
          />
        </div>
        <div className="flex-1 min-w-36">
          <label className="text-sm font-medium" htmlFor="admin-password">
            {t("password")}
          </label>
          <Input
            id="admin-password"
            mode="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            className="mt-1"
          />
        </div>
        <Button
          htmlType="submit"
          theme="solid"
          loading={submitting}
          disabled={!username.trim() || !password}
        >
          {t("add_user")}
        </Button>
      </form>
      <div className="text-xs text-zinc-500 mt-1">
        {t("username_rules")} {t("password_rules")}
      </div>

      <div className="mt-5 text-sm font-medium mb-2">
        {t("users")} ({users.length})
      </div>
      <div className="max-h-80 overflow-auto border border-color rounded-sm">
        {users.map((user) => (
          <div
            key={user.id}
            className="px-3 py-2 border-b border-color last:border-b-0"
            data-testid={`admin-user-${user.username}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`truncate ${user.disabled ? "line-through opacity-60" : ""}`}
                  >
                    {user.username}
                  </span>
                  {user.isAdmin && (
                    <Tag color="light-blue" size="small">
                      {t("admin_label")}
                    </Tag>
                  )}
                  {user.disabled && (
                    <Tag color="red" size="small">
                      {t("disabled")}
                    </Tag>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {t("created")}: {date(user.createdAt)} · {t("last_login")}:{" "}
                  {date(user.lastLoginAt)}
                </div>
              </div>
              {!user.isAdmin && (
                <span className="flex items-center gap-1 shrink-0">
                  <Button
                    size="small"
                    type="tertiary"
                    onClick={() => toggle(user.id, "password")}
                  >
                    {t("reset_password")}
                  </Button>
                  <Popconfirm
                    title={t(user.disabled ? "enable_user" : "disable_user")}
                    content={t(
                      user.disabled
                        ? "enable_user_confirm"
                        : "disable_user_confirm",
                      { username: user.username },
                    )}
                    onConfirm={() => setDisabled(user, !user.disabled)}
                  >
                    <Button size="small" type="tertiary">
                      {t(user.disabled ? "enable_user" : "disable_user")}
                    </Button>
                  </Popconfirm>
                  <Button
                    size="small"
                    type="danger"
                    onClick={() => toggle(user.id, "delete")}
                  >
                    {t("delete")}
                  </Button>
                </span>
              )}
            </div>
            {open.id === user.id && open.panel === "password" && (
              <div className="flex gap-2 mt-2">
                <Input
                  mode="password"
                  size="small"
                  placeholder={t("new_password")}
                  value={resetValue}
                  onChange={setResetValue}
                  autoComplete="new-password"
                />
                <Button
                  size="small"
                  theme="solid"
                  disabled={resetValue.length < 8}
                  onClick={() => resetPassword(user)}
                >
                  {t("save")}
                </Button>
              </div>
            )}
            {open.id === user.id && open.panel === "delete" && (
              <div className="mt-2 text-sm space-y-2">
                <div>
                  {t("delete_user_explain", { username: user.username })}
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-zinc-500 shrink-0">
                    {t("transfer_diagrams_to")}
                  </span>
                  <Select
                    size="small"
                    className="flex-1"
                    value={transferTo}
                    onChange={setTransferTo}
                    optionList={users
                      .filter((u) => u.id !== user.id && !u.disabled)
                      .map((u) => ({ value: u.id, label: u.username }))}
                  />
                  <Button
                    size="small"
                    type="danger"
                    theme="solid"
                    disabled={!transferTo}
                    onClick={() => deleteUser(user)}
                  >
                    {t("delete_user")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityTab({ users, setError }) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ userId: "", action: "" });
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const PAGE = 100;

  const load = useCallback(
    async (before) => {
      setLoading(true);
      try {
        const page = await adminApi.audit({
          ...filters,
          limit: PAGE,
          before,
        });
        setEntries((current) => (before ? [...current, ...page] : page));
        setMore(page.length === PAGE);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [filters, setError],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="flex gap-2 mb-3">
        <Select
          className="flex-1"
          placeholder={t("all_users")}
          showClear
          value={filters.userId || undefined}
          onChange={(userId) =>
            setFilters((current) => ({ ...current, userId: userId ?? "" }))
          }
          optionList={users.map((u) => ({ value: u.id, label: u.username }))}
        />
        <Select
          className="flex-1"
          placeholder={t("all_actions")}
          showClear
          filter
          value={filters.action || undefined}
          onChange={(action) =>
            setFilters((current) => ({ ...current, action: action ?? "" }))
          }
          optionList={AUDIT_ACTIONS.map((action) => ({
            value: action,
            label: t(`audit_${action.replace(/\./g, "_")}`, {
              defaultValue: action,
            }),
          }))}
        />
      </div>
      <div className="max-h-96 overflow-auto">
        <ActivityList entries={entries} showDiagram />
      </div>
      {more && (
        <Button
          block
          className="mt-2"
          loading={loading}
          onClick={() => load(entries[entries.length - 1]?.id)}
        >
          {t("load_more")}
        </Button>
      )}
    </>
  );
}

function BackupsTab({ setError }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ enabled: true, backups: [] });
  const [running, setRunning] = useState(false);

  const refresh = useCallback(
    () =>
      adminApi
        .backups()
        .then(setState)
        .catch((loadError) => setError(loadError.message)),
    [setError],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  const backUpNow = async () => {
    setRunning(true);
    try {
      const backup = await adminApi.createBackup();
      Toast.success(t("backup_done", { name: backup.name }));
      await refresh();
    } catch (backupError) {
      setError(backupError.message);
    } finally {
      setRunning(false);
    }
  };

  if (!state.enabled) {
    return (
      <Banner type="info" closeIcon={null} description={t("backups_off")} />
    );
  }
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-zinc-500">{t("backups_explain")}</span>
        <Button theme="solid" loading={running} onClick={backUpNow}>
          {t("back_up_now")}
        </Button>
      </div>
      {state.backups.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">
          {t("no_backups")}
        </div>
      ) : (
        <ul className="text-sm divide-y divide-zinc-200 dark:divide-zinc-700 max-h-80 overflow-auto">
          {state.backups.map((backup) => (
            <li
              key={backup.name}
              className="py-2 flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">
                  {backup.name}
                </span>
                <span className="text-xs text-zinc-500">
                  {DateTime.fromISO(backup.createdAt)
                    .setLocale(i18n.language)
                    .toLocaleString(DateTime.DATETIME_MED)}{" "}
                  · {formatSize(backup.size)}
                </span>
              </span>
              <a
                className="text-sm text-sky-600 hover:underline shrink-0"
                href={`/api/admin/backups/${encodeURIComponent(backup.name)}`}
                download={backup.name}
              >
                {t("download")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AdminPanel({ visible, onClose }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("users");

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError("");
    adminApi
      .listUsers()
      .then((loaded) => active && setUsers(loaded))
      .catch(
        (loadError) =>
          active && setError(loadError.message || t("failed_to_load_users")),
      );
    return () => {
      active = false;
    };
  }, [visible, t]);

  return (
    <Modal
      title={t("administration")}
      visible={visible}
      onCancel={onClose}
      footer={null}
      centered
      width={720}
      bodyStyle={{ paddingBottom: 24 }}
    >
      {error && (
        <Banner
          type="danger"
          description={error}
          className="mb-4"
          onClose={() => setError("")}
        />
      )}
      <Tabs activeKey={tab} onChange={setTab} type="line">
        <TabPane tab={t("users")} itemKey="users">
          <div className="pt-3">
            <p className="text-sm text-zinc-500 mb-3">
              {t("admin_users_subtitle")}
            </p>
            <UsersTab users={users} setUsers={setUsers} setError={setError} />
          </div>
        </TabPane>
        <TabPane tab={t("activity")} itemKey="activity">
          <div className="pt-3">
            {tab === "activity" && (
              <ActivityTab users={users} setError={setError} />
            )}
          </div>
        </TabPane>
        <TabPane tab={t("backups")} itemKey="backups">
          <div className="pt-3">
            {tab === "backups" && <BackupsTab setError={setError} />}
          </div>
        </TabPane>
      </Tabs>
    </Modal>
  );
}
