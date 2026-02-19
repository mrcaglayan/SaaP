import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth.js";

export default function RequirePermission({ anyOf = [], allOf = [], children }) {
  const { isAuthed, booting, hasAnyPermission, hasAllPermissions } = useAuth();
  const location = useLocation();

  if (booting) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const allowed =
    hasAnyPermission(anyOf) &&
    hasAllPermissions(allOf);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-amber-900">Access denied</h2>
        <p className="mt-1 text-sm text-amber-800">
          Your user is authenticated but does not have the required permission for
          this module.
        </p>
      </div>
    );
  }

  return children;
}
