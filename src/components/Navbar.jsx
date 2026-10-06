import { Link } from "react-router-dom";
import logo from "../assets/logo_light_160.png";
import { useAuth } from "../hooks";

const LINK =
  "text-lg sm:text-base font-semibold hover:text-sky-800 transition-colors duration-300";

// Only local pages: a self-hosted instance may have no Internet access.
export default function Navbar() {
  const { isAuthenticated } = useAuth();

  return (
    <>
      <div className="py-4 px-12 sm:px-4 flex justify-between items-center">
        <Link to="/editor">
          <img src={logo} alt="logo" className="h-[48px] sm:h-[32px]" />
        </Link>
        <div className="flex gap-12 sm:gap-6">
          <Link to="/editor" className={LINK}>
            Editor
          </Link>
          <Link to="/templates" className={LINK}>
            Templates
          </Link>
          {!isAuthenticated && (
            <Link to="/login" className={LINK}>
              Sign in
            </Link>
          )}
        </div>
      </div>
      <hr />
    </>
  );
}
