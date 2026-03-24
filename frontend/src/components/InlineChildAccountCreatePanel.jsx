import Combobox from "./Combobox.jsx";
import { normalizeAccountCode } from "../utils/glInlineChildAccounts.js";

export default function InlineChildAccountCreatePanel({
  l = (en) => en,
  codeCandidate,
  searchText,
  parentAccountLookupOptions,
  parentAccountId,
  onParentAccountIdChange,
  childCode,
  onChildCodeChange,
  childName,
  onChildNameChange,
  onUseTypedCode,
  onUseNextCode,
  suggestedNextCode,
  hasSelectedParent,
  onCreateChild,
  creating,
  canUpsertAccounts,
  submitting,
  permissionHint,
}) {
  const displayQuery = String(codeCandidate || searchText || "").trim();
  const canUseTypedCode = Boolean(String(codeCandidate || "").trim());

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2">
      {displayQuery ? (
        <p className="text-xs text-cyan-800">
          {l(
            `No exact account found for "${displayQuery}". Create a child account below.`,
            `"${displayQuery}" icin tam hesap bulunamadi. Asagida child hesap olusturun.`
          )}
        </p>
      ) : (
        <p className="text-xs text-cyan-800">
          {l("Create a child account below.", "Asagida child hesap olusturun.")}
        </p>
      )}
      <Combobox
        value={parentAccountId || null}
        options={parentAccountLookupOptions}
        disabled={submitting || creating}
        placeholder={l("Select parent account", "Parent hesap secin")}
        noOptionsText={l("No parent accounts found.", "Parent hesap bulunamadi.")}
        onChange={(nextValue) => onParentAccountIdChange?.(nextValue ? String(nextValue) : "")}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={childCode}
          onChange={(event) =>
            onChildCodeChange?.(normalizeAccountCode(event.target.value))
          }
          className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs"
          placeholder={l("Child account code", "Child hesap kodu")}
          maxLength={60}
        />
        <input
          value={childName}
          onChange={(event) => onChildNameChange?.(event.target.value)}
          className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs"
          placeholder={l("New child account name", "Yeni child hesap adi")}
          maxLength={255}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUseTypedCode}
          disabled={!canUseTypedCode}
          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
        >
          {l("Use searched code", "Aranan kodu kullan")}
        </button>
        <button
          type="button"
          onClick={onUseNextCode}
          disabled={!suggestedNextCode || !hasSelectedParent}
          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
        >
          {l("Use next child code", "Sonraki child kodunu kullan")}
        </button>
        <button
          type="button"
          onClick={onCreateChild}
          disabled={creating || submitting || !canUpsertAccounts}
          className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
        >
          {creating
            ? l("Creating child...", "Child olusturuluyor...")
            : l("Create child account", "Child hesap olustur")}
        </button>
      </div>
      {!canUpsertAccounts ? (
        <p className="text-[11px] text-amber-700">
          {permissionHint || l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert")}
        </p>
      ) : null}
    </div>
  );
}
