import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth.js";

export default function RequireAuth({ children }) {
  const { isAuthed, booting } = useAuth();
  const location = useLocation();

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
