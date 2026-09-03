import { useEffect, useState } from "react";
import { Banner, Button, Input, Modal, Tag, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { adminApi } from "../../api/auth";

export default function AdminPanel({ visible, onClose }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <Modal
      title={t("administration")}
      visible={visible}
      onCancel={onClose}
      footer={null}
      centered
      width={480}
      bodyStyle={{ paddingBottom: 24 }}
    >
      <p className="text-sm text-zinc-500 mb-4">{t("admin_users_subtitle")}</p>

      {error && (
        <Banner
          type="danger"
          closeIcon={null}
          description={error}
          className="mb-4"
        />
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
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
          <div className="text-xs text-zinc-500 mt-1">
            {t("username_rules")}
          </div>
        </div>
        <div>
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
          <div className="text-xs text-zinc-500 mt-1">
            {t("password_rules")}
          </div>
        </div>
        <Button
          htmlType="submit"
          theme="solid"
          block
          loading={submitting}
          disabled={!username.trim() || !password}
        >
          {t("add_user")}
        </Button>
      </form>

      <div className="mt-6">
        <div className="text-sm font-medium mb-2">
          {t("users")} ({users.length})
        </div>
        <div className="max-h-56 overflow-auto border border-color rounded-sm">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between px-3 py-2 border-b border-color last:border-b-0"
            >
              <span className="truncate">{user.username}</span>
              {user.isAdmin && (
                <Tag color="light-blue" size="small">
                  {t("admin_label")}
                </Tag>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
