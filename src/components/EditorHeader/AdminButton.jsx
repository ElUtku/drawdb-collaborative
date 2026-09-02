import { useState } from "react";
import { Button, Tooltip } from "@douyinfe/semi-ui";
import { IconUserGroup } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks";
import AdminPanel from "./AdminPanel";

export default function AdminButton() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      <Tooltip content={t("administration")} position="bottom">
        <Button
          type="tertiary"
          theme="borderless"
          icon={<IconUserGroup />}
          aria-label={t("administration")}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <AdminPanel visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
