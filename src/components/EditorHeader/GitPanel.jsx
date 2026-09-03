import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Collapse,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Tag,
  Toast,
} from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { gitApi } from "../../api/git";
import { State } from "../../data/constants";
import {
  useAuth,
  useDiagram,
  useEnums,
  useSaveState,
  useTypes,
} from "../../hooks";
import { buildSchemaSql } from "../../utils/gitSync";

const EMPTY_FORM = {
  remoteUrl: "",
  branch: "main",
  directory: "",
  fileName: "",
  authUsername: "",
  token: "",
  authorName: "",
  authorEmail: "",
};

const SAVE_POLL_MS = 150;
const SAVE_TIMEOUT_MS = 6000;

export default function GitPanel({
  open,
  onClose,
  diagramId,
  title,
  applyDiagram,
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { tables, relationships, database } = useDiagram();
  const { types } = useTypes();
  const { enums } = useEnums();
  const { saveState, setSaveState } = useSaveState();

  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [canConfigure, setCanConfigure] = useState(true);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [commits, setCommits] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const saveStateRef = useRef(saveState);
  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  const applySettings = useCallback((state) => {
    setAvailable(state.available !== false);
    setCanConfigure(state.canConfigure !== false);
    setSettings(state.settings ?? null);
    setForm(
      state.settings
        ? {
            ...EMPTY_FORM,
            ...state.settings,
            directory: state.settings.directory ?? "",
            authUsername: state.settings.authUsername ?? "",
            authorName: state.settings.authorName ?? "",
            authorEmail: state.settings.authorEmail ?? "",
            token: "",
          }
        : EMPTY_FORM,
    );
  }, []);

  useEffect(() => {
    if (!open || !diagramId) return;
    let active = true;
    setLoading(true);
    setError("");
    setCommits([]);
    gitApi
      .get(diagramId)
      .then((state) => {
        if (!active) return;
        applySettings(state);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, diagramId, applySettings]);

  const update = (field) => (value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const run = async (name, action) => {
    setBusy(name);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  };

  const saveSettings = () =>
    run("save", async () => {
      const payload = {
        remoteUrl: form.remoteUrl,
        branch: form.branch,
        directory: form.directory,
        fileName: form.fileName || undefined,
        authUsername: form.authUsername,
        authorName: form.authorName,
        authorEmail: form.authorEmail,
      };
      // An untouched token field leaves the stored credential alone.
      if (form.token) payload.token = form.token;
      const result = await gitApi.save(diagramId, payload);
      applySettings({ available, canConfigure, settings: result.settings });
      Toast.success(t("git_settings_saved"));
    });

  const testConnection = () =>
    run("test", async () => {
      const result = await gitApi.test(diagramId);
      if (result.branchExists) Toast.success(t("git_connection_ok"));
      else Toast.info(t("git_branch_missing", { branch: result.branch }));
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await gitApi.disconnect(diagramId);
      applySettings({ available, canConfigure, settings: null });
      setCommits([]);
    });

  const loadHistory = () =>
    run("history", async () => {
      const result = await gitApi.history(diagramId);
      setCommits(result.commits);
    });

  // The server commits the stored snapshot, so a pending local edit has to
  // reach the server before the commit is made.
  const flushPendingSave = async () => {
    if (saveStateRef.current === State.SAVED) return;
    setSaveState(State.SAVING);
    const deadline = Date.now() + SAVE_TIMEOUT_MS;
    while (saveStateRef.current !== State.SAVED && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SAVE_POLL_MS));
    }
  };

  const push = () =>
    run("push", async () => {
      await flushPendingSave();
      const sql = buildSchemaSql({
        database,
        tables,
        references: relationships,
        types,
        enums,
      });
      const result = await gitApi.push(diagramId, { sql, message });
      setSettings(result.settings ?? settings);
      setMessage("");
      setCommits([]);
      if (result.status === "pushed") {
        Toast.success(t("git_pushed", { commit: result.commit.slice(0, 7) }));
      } else {
        Toast.info(t("git_unchanged"));
      }
    });

  const pull = () =>
    run("pull", async () => {
      const result = await gitApi.pull(diagramId);
      applyDiagram?.(result.diagram, { remote: true });
      setSaveState(State.SAVED);
      Toast.success(t("git_pulled", { commit: result.commit.slice(0, 7) }));
    });

  const filePath = settings
    ? `${settings.directory ? `${settings.directory}/` : ""}${settings.fileName}`
    : "";
  const working = Boolean(busy);
  const disabled = !canConfigure || working;

  const field = (label, key, { hint, ...props } = {}) => (
    <div>
      <label className="text-sm font-medium" htmlFor={`git-${key}`}>
        {label}
      </label>
      <Input
        id={`git-${key}`}
        value={form[key]}
        onChange={update(key)}
        disabled={disabled}
        autoComplete="off"
        className="mt-1"
        {...props}
      />
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );

  return (
    <Modal
      title={t("git_sync")}
      visible={open}
      onCancel={onClose}
      footer={null}
      centered
      width={620}
      bodyStyle={{ maxHeight: "70vh", overflow: "auto", paddingBottom: 24 }}
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spin size="large" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {!available && (
            <Banner
              type="warning"
              closeIcon={null}
              description={t("git_unavailable")}
            />
          )}
          {!canConfigure && (
            <Banner
              type="info"
              closeIcon={null}
              description={t("git_owner_only")}
            />
          )}
          {error && (
            <Banner type="danger" closeIcon={null} description={error} />
          )}

          <div className="rounded-sm border border-color p-3 text-sm">
            {settings ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">
                    {settings.remoteUrl}
                  </span>
                  <Tag size="small" color="light-blue">
                    {settings.branch}
                  </Tag>
                </div>
                <div className="text-xs text-zinc-500">
                  {t("git_files", {
                    json: `${filePath}.json`,
                    sql: `${filePath}.sql`,
                  })}
                </div>
                {settings.lastSyncedAt && (
                  <div className="text-xs text-zinc-500">
                    {t("git_last_sync", {
                      when: DateTime.fromISO(settings.lastSyncedAt)
                        .setLocale(i18n.language)
                        .toRelative(),
                      commit: (settings.lastCommit ?? "").slice(0, 7),
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">{t("git_not_connected_hint")}</div>
            )}
          </div>

          {settings && (
            <div className="flex flex-col gap-2">
              <Input
                value={message}
                onChange={setMessage}
                disabled={working}
                placeholder={t("git_commit_message_placeholder")}
                aria-label={t("git_commit_message")}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  theme="solid"
                  loading={busy === "push"}
                  disabled={working || !available}
                  onClick={push}
                >
                  {t("git_push")}
                </Button>
                <Popconfirm
                  title={t("git_pull")}
                  content={t("git_pull_confirm")}
                  okText={t("continue")}
                  cancelText={t("cancel")}
                  onConfirm={pull}
                >
                  <Button
                    type="tertiary"
                    loading={busy === "pull"}
                    disabled={working || !available}
                  >
                    {t("git_pull")}
                  </Button>
                </Popconfirm>
                <Button
                  type="tertiary"
                  loading={busy === "test"}
                  disabled={working || !available}
                  onClick={testConnection}
                >
                  {t("git_test_connection")}
                </Button>
                <Button
                  type="tertiary"
                  loading={busy === "history"}
                  disabled={working || !available}
                  onClick={loadHistory}
                >
                  {t("git_history")}
                </Button>
              </div>
            </div>
          )}

          {commits.length > 0 && (
            <div className="border border-color rounded-sm max-h-48 overflow-auto">
              {commits.map((commit) => (
                <div
                  key={commit.commit}
                  className="px-3 py-2 border-b border-color last:border-b-0 text-sm"
                >
                  <div className="truncate">{commit.message}</div>
                  <div className="text-xs text-zinc-500">
                    {commit.commit.slice(0, 7)} · {commit.author} ·{" "}
                    {DateTime.fromISO(commit.date)
                      .setLocale(i18n.language)
                      .toRelative()}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-color pt-3">
            <div className="text-sm font-medium">{t("git_repository")}</div>
            {field(t("git_remote_url"), "remoteUrl", {
              placeholder: "https://github.com/acme/schema.git",
              hint: t("git_remote_url_hint"),
            })}
            <div className="grid grid-cols-2 gap-3">
              {field(t("git_branch"), "branch", { placeholder: "main" })}
              {field(t("git_directory"), "directory", {
                placeholder: "db/schema",
                hint: t("git_directory_hint"),
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field(t("git_file_name"), "fileName", {
                placeholder: title,
                hint: t("git_file_name_hint"),
              })}
              {field(t("git_auth_username"), "authUsername", {
                placeholder: "x-access-token",
                hint: t("git_auth_username_hint"),
              })}
            </div>
            {field(t("git_token"), "token", {
              mode: "password",
              placeholder: settings?.hasToken ? t("git_token_stored") : "",
              hint: t("git_token_hint"),
            })}
            <Collapse keepDOM={false}>
              <Collapse.Panel
                header={<span className="text-sm">{t("git_token_help")}</span>}
                itemKey="token-help"
              >
                <div className="text-xs text-zinc-500 flex flex-col gap-2">
                  <div>
                    <div className="font-medium">
                      {t("git_token_help_github")}
                    </div>
                    <ul className="list-disc ps-4 mt-1 flex flex-col gap-1">
                      <li>{t("git_token_help_github_owner")}</li>
                      <li>{t("git_token_help_github_repository")}</li>
                      <li>{t("git_token_help_github_contents")}</li>
                      <li>{t("git_token_help_github_metadata")}</li>
                      <li>{t("git_token_help_github_expiry")}</li>
                    </ul>
                  </div>
                  <div>{t("git_token_help_gitlab")}</div>
                  <div>{t("git_token_help_sso")}</div>
                  <div>{t("git_token_help_protected")}</div>
                </div>
              </Collapse.Panel>
            </Collapse>
            <div className="grid grid-cols-2 gap-3">
              {field(t("git_author_name"), "authorName", {
                placeholder: user?.username ?? "drawDB",
              })}
              {field(t("git_author_email"), "authorEmail", {
                placeholder: `${user?.username ?? "drawdb"}@drawdb.local`,
              })}
            </div>
            <div className="flex gap-2">
              <Button
                theme="solid"
                loading={busy === "save"}
                disabled={disabled || !form.remoteUrl.trim()}
                onClick={saveSettings}
              >
                {t("git_save_settings")}
              </Button>
              {settings && canConfigure && (
                <Popconfirm
                  title={t("git_disconnect")}
                  content={t("git_disconnect_confirm")}
                  okText={t("continue")}
                  cancelText={t("cancel")}
                  onConfirm={disconnect}
                >
                  <Button type="danger" disabled={working}>
                    {t("git_disconnect")}
                  </Button>
                </Popconfirm>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
