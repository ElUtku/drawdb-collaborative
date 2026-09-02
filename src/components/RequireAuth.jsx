import { Navigate, useLocation } from "react-router-dom";
import { Spin } from "@douyinfe/semi-ui";
import { AUTH_STATUS } from "../context/AuthContext";
import { useAuth } from "../hooks";

export default function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === AUTH_STATUS.LOADING) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }
  if (status !== AUTH_STATUS.AUTHENTICATED) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return children;
}
