import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  Toast,
} from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { diagramApi, userApi } from "../../api/diagrams";
import { useAuth } from "../../hooks";

// Who can open a diagram: its owner, the people it is shared with (as viewers
// or editors) and, optionally, everyone signed in to this server.
export default function ShareModal({ open, onClose, diagramId }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [access, setAccess] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newMember, setNewMember] = useState(null);
  const [newRole, setNewRole] = useState("viewer");
  const [newOwner, setNewOwner] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [summary, directory] = await Promise.all([
        diagramApi.access(diagramId),
        userApi.directory(),
      ]);
      setAccess(summary);
      setPeople(directory);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [diagramId]);

  useEffect(() => {
    if (open && diagramId) load();
    if (!open) {
      setAccess(null);
      setNewMember(null);
      setNewOwner(null);
    }
  }, [open, diagramId, load]);

  const run = async (action, success) => {
    setBusy(true);
    setError("");
    try {
      const summary = await action();
      if (summary?.linkAccess)
        setAccess((current) => ({ ...current, ...summary }));
      if (success) Toast.success(success);
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isOwner = access?.role === "owner";
  const memberIds = new Set((access?.members ?? []).map((m) => m.userId));
  const candidates = people.filter(
    (p) => p.id !== access?.owner?.userId && !memberIds.has(p.id),
  );
  const roleOptions = [
    { value: "viewer", label: t("role_viewer") },
    { value: "editor", label: t("role_editor") },
  ];

  const body = () => {
    if (!access) {
      return error ? null : (
        <div className="py-8 text-center">
          <Spin />
        </div>
      );
    }
    return (
      <div className="space-y-5">
        <div className="text-sm">
          {t("your_role")}:{" "}
          <Tag color={isOwner ? "green" : "blue"}>
            {t(`role_${access.role}`)}
          </Tag>
          {access.owner && (
            <span className="ms-3 text-zinc-500">
              {t("owner")}: {access.owner.username}
            </span>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-1">{t("link_access")}</div>
          <Select
            className="w-full"
            disabled={!isOwner || busy}
            value={access.linkAccess}
            onChange={(linkAccess) =>
              run(
                () => diagramApi.setLinkAccess(diagramId, linkAccess),
                t("sharing_saved"),
              )
            }
            optionList={["none", "viewer", "editor"].map((value) => ({
              value,
              label: t(`link_access_${value}`),
            }))}
          />
          <div className="text-xs text-zinc-500 mt-1">
            {t(`link_access_${access.linkAccess}_desc`)}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-1">
            {t("people_with_access")} ({access.members.length})
          </div>
          <div className="border border-color rounded-sm divide-y divide-zinc-200 dark:divide-zinc-700">
            {access.members.length === 0 && (
              <div className="px-3 py-2 text-sm text-zinc-500">
                {t("not_shared_yet")}
              </div>
            )}
            {access.members.map((member) => (
              <div
                key={member.userId}
                className="px-3 py-2 flex items-center justify-between gap-2"
                data-testid={`member-${member.username}`}
              >
                <span className="truncate text-sm">{member.username}</span>
                <span className="flex items-center gap-2">
                  <Select
                    size="small"
                    className="w-28"
                    disabled={!isOwner || busy}
                    value={member.role}
                    optionList={roleOptions}
                    onChange={(role) =>
                      run(
                        () =>
                          diagramApi.setMember(diagramId, member.userId, role),
                        t("sharing_saved"),
                      )
                    }
                  />
                  {(isOwner || member.userId === user?.id) && (
                    <Button
                      size="small"
                      type="danger"
                      theme="borderless"
                      disabled={busy}
                      onClick={async () => {
                        const left = member.userId === user?.id && !isOwner;
                        const done = await run(
                          () =>
                            diagramApi.removeMember(diagramId, member.userId),
                          left ? t("left_diagram") : t("sharing_saved"),
                        );
                        if (done && left) onClose();
                      }}
                    >
                      {member.userId === user?.id && !isOwner
                        ? t("leave")
                        : t("remove")}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {isOwner && (
          <div>
            <div className="text-sm font-medium mb-1">{t("share_with")}</div>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                filter
                placeholder={t("pick_user")}
                value={newMember ?? undefined}
                onChange={setNewMember}
                emptyContent={t("no_more_users")}
                optionList={candidates.map((p) => ({
                  value: p.id,
                  label: p.username,
                }))}
              />
              <Select
                className="w-28"
                value={newRole}
                onChange={setNewRole}
                optionList={roleOptions}
              />
              <Button
                theme="solid"
                disabled={!newMember || busy}
                onClick={async () => {
                  const done = await run(
                    () => diagramApi.setMember(diagramId, newMember, newRole),
                    t("sharing_saved"),
                  );
                  if (done) setNewMember(null);
                }}
              >
                {t("share")}
              </Button>
            </div>
          </div>
        )}

        {isOwner && (
          <div>
            <div className="text-sm font-medium mb-1">
              {t("transfer_ownership")}
            </div>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                filter
                placeholder={t("pick_user")}
                value={newOwner ?? undefined}
                onChange={setNewOwner}
                optionList={people
                  .filter((p) => p.id !== access.owner?.userId)
                  .map((p) => ({ value: p.id, label: p.username }))}
              />
              <Popconfirm
                title={t("transfer_ownership")}
                content={t("transfer_ownership_confirm")}
                onConfirm={() =>
                  run(
                    () => diagramApi.transferOwner(diagramId, newOwner),
                    t("ownership_transferred"),
                  ).then((done) => done && load())
                }
              >
                <Button type="warning" disabled={!newOwner || busy}>
                  {t("transfer")}
                </Button>
              </Popconfirm>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {t("transfer_ownership_desc")}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={t("share")}
      visible={open}
      onCancel={onClose}
      footer={null}
      centered
      width={560}
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
      {body()}
    </Modal>
  );
}
