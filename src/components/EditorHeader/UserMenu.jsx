import { useNavigate } from "react-router-dom";
import { Avatar, Dropdown } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks";

export default function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  if (!user) return null;

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <Dropdown
      position="bottomRight"
      render={
        <Dropdown.Menu>
          <Dropdown.Title>
            {t("signed_in_as")} {user.username}
          </Dropdown.Title>
          <Dropdown.Item type="danger" onClick={signOut}>
            {t("sign_out")}
          </Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <Avatar size="extra-small" color="light-blue" className="cursor-pointer">
        {user.username.slice(0, 2).toUpperCase()}
      </Avatar>
    </Dropdown>
  );
}
