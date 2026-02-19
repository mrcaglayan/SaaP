import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nContext } from "./i18nContext.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  messages,
  SUPPORTED_LANGUAGES,
} from "./messages.js";

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

function getInitialLanguage() {
  const fromStorage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (fromStorage && SUPPORTED_LANGUAGES.includes(fromStorage)) {
    return fromStorage;
  }

  const browserLang = navigator.language?.toLowerCase() || "";
  if (browserLang.startsWith("tr")) {
    return "tr";
  }
  if (browserLang.startsWith("en")) {
    return "en";
  }
  return DEFAULT_LANGUAGE;
}

function resolvePath(obj, pathParts) {
  return pathParts.reduce((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return acc[part];
  }, obj);
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageState((current) => {
      const normalized = normalizeLanguage(nextLanguage);
      return normalized === current ? current : normalized;
    });
  }, []);

  const t = useCallback(
    (key, fallback) => {
      const pathParts = Array.isArray(key) ? key : String(key).split(".");
      const activeMessages = messages[language] || messages[DEFAULT_LANGUAGE];
      const activeValue = resolvePath(activeMessages, pathParts);
      if (typeof activeValue === "string") {
        return activeValue;
      }

      const defaultValue = resolvePath(messages[DEFAULT_LANGUAGE], pathParts);
      if (typeof defaultValue === "string") {
        return defaultValue;
      }

      if (fallback !== undefined) {
        return fallback;
      }

      return Array.isArray(key) ? key.join(".") : String(key);
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      supportedLanguages: SUPPORTED_LANGUAGES,
      t,
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
