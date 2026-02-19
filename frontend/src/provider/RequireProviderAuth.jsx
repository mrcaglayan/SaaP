import { Navigate, useLocation } from "react-router-dom";
import { useProviderAuth } from "./useProviderAuth.js";

export default function RequireProviderAuth({ children }) {
  const { isAuthed, booting } = useProviderAuth();
  const location = useLocation();

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100">
        <div className="text-slate-600">Loading provider session...</div>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/provider/login" replace state={{ from: location }} />;
  }

  return children;
}
