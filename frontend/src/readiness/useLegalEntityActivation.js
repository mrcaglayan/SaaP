import { useContext } from "react";
import { LegalEntityActivationContext } from "./legalEntityActivationContext.js";

/**
 * Reads the scoped legal-entity activation readiness snapshot for the current
 * user and exposes refresh helpers keyed by legal entity.
 */
export function useLegalEntityActivation() {
  const value = useContext(LegalEntityActivationContext);
  if (!value) {
    throw new Error(
      "useLegalEntityActivation must be used within LegalEntityActivationProvider"
    );
  }
  return value;
}
