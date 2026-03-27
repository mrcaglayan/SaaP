import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCariDocumentOpenItems } from "../../../api/cariDocuments.js";
import { listExceptionWorkbench } from "../../../api/exceptionsWorkbench.js";
import { getJournal } from "../../../api/glAdmin.js";
import { listCariAudit } from "../../../api/cariAudit.js";
import { useAuth } from "../../../auth/useAuth.js";
import MoneyText from "../../../components/MoneyText.jsx";
import {
  formatDateTime,
  normalizeApiError,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

/**
 * Renders the read-only related-record sections keyed from the selected document snapshot.
 */
export default function CariDocumentRelatedPanel({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const { hasPermission } = useAuth();
  const canReadGlJournals = hasPermission("gl.journal.read");
  const canReadExceptions = hasPermission("ops.exceptions.read");
  const canReadCariAudit = hasPermission("cari.audit.read");
  const selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id);
  const selectedDocumentLegalEntityId = toPositiveInt(
    selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
  );
  const selectedPostedJournalEntryId = toPositiveInt(
    selectedSnapshot?.postedJournalEntryId || selectedSnapshot?.posted_journal_entry_id
  );
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState("");
  const [relatedJournal, setRelatedJournal] = useState(null);
  const [relatedOpenItems, setRelatedOpenItems] = useState([]);
  const [relatedExceptions, setRelatedExceptions] = useState([]);
  const [relatedAuditRows, setRelatedAuditRows] = useState([]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    const legalEntityId = selectedDocumentLegalEntityId;
    if (!canRead || !documentId) {
      return;
    }

    let active = true;
    async function loadRelatedPanel() {
      // This stays keyed from selectedSnapshot so related data starts loading on row click
      // before full detail finishes hydrating.
      setRelatedLoading(true);
      setRelatedError("");
      let nextJournal = null;
      let nextOpenItems = [];
      let nextExceptions = [];
      let nextAuditRows = [];
      const errors = [];

      try {
        const openItemsResponse = await getCariDocumentOpenItems(documentId);
        nextOpenItems = Array.isArray(openItemsResponse?.rows)
          ? openItemsResponse.rows
          : [];
      } catch (error) {
        errors.push(
          normalizeApiError(
            error,
            l("Related open items failed to load.", "Ilgili acik kalemler yuklenemedi.")
          )
        );
      }

      if (canReadGlJournals && selectedPostedJournalEntryId) {
        try {
          const journalResponse = await getJournal(selectedPostedJournalEntryId);
          nextJournal = journalResponse?.row || null;
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related GL journal failed to load.", "Ilgili yevmiye kaydi yuklenemedi.")
            )
          );
        }
      }

      if (canReadExceptions) {
        try {
          const exceptionResponse = await listExceptionWorkbench({
            legalEntityId: legalEntityId || undefined,
            sourceRefId: documentId,
            refresh: false,
            limit: 25,
            offset: 0,
            sortBy: "URGENCY",
          });
          nextExceptions = Array.isArray(exceptionResponse?.rows)
            ? exceptionResponse.rows
            : [];
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related exceptions failed to load.", "Ilgili istisnalar yuklenemedi.")
            )
          );
        }
      }

      if (canReadCariAudit) {
        try {
          const auditResponse = await listCariAudit({
            legalEntityId: legalEntityId || undefined,
            resourceType: "cari_document",
            resourceId: String(documentId),
            includePayload: false,
            limit: 20,
            offset: 0,
          });
          nextAuditRows = Array.isArray(auditResponse?.rows)
            ? auditResponse.rows
            : [];
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related audit trail failed to load.", "Ilgili denetim kayitlari yuklenemedi.")
            )
          );
        }
      }

      if (!active) {
        return;
      }
      setRelatedJournal(nextJournal);
      setRelatedOpenItems(nextOpenItems);
      setRelatedExceptions(nextExceptions);
      setRelatedAuditRows(nextAuditRows);
      setRelatedError(errors.join(" "));
      setRelatedLoading(false);
    }

    loadRelatedPanel();
    return () => {
      active = false;
    };
  }, [
    canRead,
    canReadCariAudit,
    canReadExceptions,
    canReadGlJournals,
    l,
    selectedDocumentLegalEntityId,
    selectedDocumentNumericId,
    selectedPostedJournalEntryId,
  ]);

  return (
    <>
      {relatedLoading ? (
        <p className="mt-1 text-slate-600">
          {l("Loading related records...", "Iliskili kayitlar yukleniyor...")}
        </p>
      ) : null}
      {relatedError ? <p className="mt-1 text-rose-700">{relatedError}</p> : null}

      <div>
        <p className="font-semibold text-slate-700">{l("GL journal", "GL yevmiyesi")}</p>
        {!canReadGlJournals ? (
          <p className="mt-1 text-slate-500">
            {l("Missing permission: gl.journal.read", "Eksik yetki: gl.journal.read")}
          </p>
        ) : !selectedPostedJournalEntryId ? (
          <p className="mt-1 text-slate-600">
            {l("No posted journal linked yet.", "Henuz bagli kaydedilmis yevmiye yok.")}
          </p>
        ) : !relatedJournal ? (
          <p className="mt-1 text-slate-600">
            {l("Linked journal id:", "Bagli yevmiye ID:")} {selectedPostedJournalEntryId}
          </p>
        ) : (
          <>
            <p className="mt-1 text-slate-700">
              id={relatedJournal.id || "-"} | no={relatedJournal.journal_no || "-"} |
              status={relatedJournal.status || "-"}
            </p>
            <Link
              to={`/app/mahsup-islemleri?journalId=${relatedJournal.id}`}
              className="mt-1 inline-block rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
            >
              {l("Open in Journal Workbench", "Yevmiye Calisma Ekraninda Ac")}
            </Link>
            {Array.isArray(relatedJournal.source_links) &&
            relatedJournal.source_links.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {relatedJournal.source_links.map((linkRow) => (
                  <li
                    key={`journal-source-link-${linkRow.id}`}
                    className="rounded border border-slate-200 bg-white px-2 py-1"
                  >
                    {linkRow.source_ref_type || "-"}#{linkRow.source_ref_id || "-"} (
                    {linkRow.link_role || "-"})
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div>
        <p className="font-semibold text-slate-700">{l("Open items", "Acik kalemler")}</p>
        {relatedOpenItems.length === 0 ? (
          <p className="mt-1 text-slate-600">
            {l(
              "No open items found for this document.",
              "Bu belge icin acik kalem bulunmuyor."
            )}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {relatedOpenItems.map((row) => (
              <li
                key={`related-open-item-${row.id}`}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              >
                itemNo={row.itemNo || "-"} | status={row.status || "-"} | residual=
                <MoneyText
                  amount={row.residualAmountTxn}
                  currencyCode={row.currencyCode}
                  className="ml-1"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-semibold text-slate-700">{l("Exceptions", "Istisnalar")}</p>
        {!canReadExceptions ? (
          <p className="mt-1 text-slate-500">
            {l(
              "Missing permission: ops.exceptions.read",
              "Eksik yetki: ops.exceptions.read"
            )}
          </p>
        ) : relatedExceptions.length === 0 ? (
          <p className="mt-1 text-slate-600">
            {l(
              "No related exceptions for this source id.",
              "Bu kaynak ID icin iliskili istisna yok."
            )}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {relatedExceptions.map((row) => (
              <li
                key={`related-exception-${row.id}`}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              >
                <div>
                  #{row.id} {row.status || "-"} | {row.severity || "-"}
                </div>
                <div className="text-slate-600">{row.title || "-"}</div>
                <Link
                  to={`/app/ayarlar/exception-workbench?exceptionId=${row.id}`}
                  className="mt-1 inline-block rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {l("Open Exception", "Istisnayi Ac")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-semibold text-slate-700">{l("Audit trail", "Denetim izi")}</p>
        {!canReadCariAudit ? (
          <p className="mt-1 text-slate-500">
            {l("Missing permission: cari.audit.read", "Eksik yetki: cari.audit.read")}
          </p>
        ) : relatedAuditRows.length === 0 ? (
          <p className="mt-1 text-slate-600">
            {l(
              "No audit records found for this document.",
              "Bu belge icin denetim kaydi bulunmadi."
            )}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {relatedAuditRows.map((row) => (
              <li
                key={`related-audit-${row.auditLogId}`}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              >
                {row.action || "-"} | {formatDateTime(row.createdAt)} | actor=
                {row.actorEmail || row.actorUserId || "-"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
