import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Banner, Button, Input, Spin } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import icon from "../assets/icon_dark_64.png";
import { authApi } from "../api/auth";
import { AUTH_STATUS } from "../context/AuthContext";
import { useAuth, useThemedPage } from "../hooks";

export default function Login({ mode = "login" }) {
  useThemedPage();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, isAuthenticated, login, register } = useAuth();

  // The first person to sign up claims the instance and becomes the
  // administrator. After that, sign-up is available only when the server runs
  // with OPEN_REGISTRATION enabled.
  const [setupRequired, setSetupRequired] = useState(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  useEffect(() => {
    let active = true;
    authApi
      .status()
      .then(({ setupRequired: required, registrationOpen: open }) => {
        if (!active) return;
        setSetupRequired(required);
        setRegistrationOpen(Boolean(open));
      })
      .catch(() => {
        if (active) setSetupRequired(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const isRegister = mode === "register";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from ?? "/editor";

  if (status === AUTH_STATUS.LOADING || setupRequired === null) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }
  if (isAuthenticated) return <Navigate to={redirectTo} replace />;
  const canRegister = setupRequired || registrationOpen;
  if (isRegister && !canRegister) {
    return <Navigate to="/login" replace state={location.state} />;
  }

  const registerTitle = !isRegister
    ? "sign_in"
    : setupRequired
      ? "create_admin_account"
      : "create_account";
  const registerSubtitle = !isRegister
    ? "sign_in_subtitle"
    : setupRequired
      ? "create_admin_subtitle"
      : "create_account_subtitle";

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (isRegister && password !== confirmation) {
      setError(t("passwords_do_not_match"));
      return;
    }
    setSubmitting(true);
    try {
      const credentials = { username: username.trim(), password };
      if (isRegister) await register(credentials);
      else await login(credentials);
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      setError(
        submitError.message ||
          t(isRegister ? "sign_up_failed" : "sign_in_failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-800 p-8 shadow-xs">
        <div className="flex flex-col items-center mb-6">
          <img src={icon} width={48} alt="drawDB" />
          <h1 className="text-xl font-semibold mt-3">{t(registerTitle)}</h1>
          <p className="text-sm text-zinc-500 mt-1 text-center">
            {t(registerSubtitle)}
          </p>
        </div>

        {error && (
          <Banner
            type="danger"
            closeIcon={null}
            description={error}
            className="mb-4"
          />
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium" htmlFor="username">
              {t("username")}
            </label>
            <Input
              id="username"
              value={username}
              onChange={setUsername}
              autoComplete="username"
              autoFocus
              className="mt-1"
            />
            {isRegister && (
              <div className="text-xs text-zinc-500 mt-1">
                {t("username_rules")}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="password">
              {t("password")}
            </label>
            <Input
              id="password"
              mode="password"
              value={password}
              onChange={setPassword}
              autoComplete={isRegister ? "new-password" : "current-password"}
              className="mt-1"
            />
            {isRegister && (
              <div className="text-xs text-zinc-500 mt-1">
                {t("password_rules")}
              </div>
            )}
          </div>

          {isRegister && (
            <div>
              <label className="text-sm font-medium" htmlFor="confirmation">
                {t("confirm_password")}
              </label>
              <Input
                id="confirmation"
                mode="password"
                value={confirmation}
                onChange={setConfirmation}
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
          )}

          <Button
            htmlType="submit"
            theme="solid"
            size="large"
            block
            loading={submitting}
            disabled={!username.trim() || !password}
          >
            {t(registerTitle)}
          </Button>
        </form>

        <div className="text-sm text-center mt-5 text-zinc-500">
          {isRegister && (
            <>
              {t("have_account")}{" "}
              <Link
                to="/login"
                state={location.state}
                className="text-sky-700 hover:underline"
              >
                {t("sign_in")}
              </Link>
            </>
          )}
          {!isRegister &&
            (canRegister ? (
              <>
                {!setupRequired && <>{t("no_account")} </>}
                <Link
                  to="/register"
                  state={location.state}
                  className="text-sky-700 hover:underline"
                >
                  {t(setupRequired ? "set_up_instance" : "create_account")}
                </Link>
              </>
            ) : (
              t("registration_closed")
            ))}
        </div>
      </div>
    </div>
  );
}
