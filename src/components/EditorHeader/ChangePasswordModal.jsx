import { useState } from "react";
import { Banner, Button, Input, Modal, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { authApi } from "../../api/auth";

export default function ChangePasswordModal({ visible, onClose }) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setError("");
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmation) {
      setError(t("passwords_do_not_match"));
      return;
    }
    setSubmitting(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      Toast.success(t("password_changed"));
      close();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t("change_password")}
      visible={visible}
      onCancel={close}
      footer={null}
      centered
      width={420}
      bodyStyle={{ paddingBottom: 24 }}
    >
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
          <label className="text-sm font-medium" htmlFor="current-password">
            {t("current_password")}
          </label>
          <Input
            id="current-password"
            mode="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="new-password">
            {t("new_password")}
          </label>
          <Input
            id="new-password"
            mode="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            className="mt-1"
          />
          <div className="text-xs text-zinc-500 mt-1">
            {t("password_rules")}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="confirm-new-password">
            {t("confirm_password")}
          </label>
          <Input
            id="confirm-new-password"
            mode="password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            className="mt-1"
          />
        </div>
        <Button
          htmlType="submit"
          theme="solid"
          block
          loading={submitting}
          disabled={!currentPassword || !newPassword || !confirmation}
        >
          {t("change_password")}
        </Button>
      </form>
    </Modal>
  );
}
