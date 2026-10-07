import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="p-3 space-y-2">
      <p>This page does not exist.</p>
      <p>
        <Link className="text-blue-600" to="/editor">
          Go to the editor
        </Link>
      </p>
    </div>
  );
}
