import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCariDocument } from "../../../api/cariDocuments.js";
import { listFixedAssets } from "../../../api/fixedAssets.js";
import {
  buildRowsById,
  FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES,
  FIXED_ASSET_AR_ELIGIBLE_STATUSES,
  normalizeApiError,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

export default function useCariDocumentDetailController({
  selectedDocumentId = null,
  detailRefreshToken = 0,
  selectedSnapshot: shellSelectedSnapshot = null,
  canRead = false,
  canReadFixedAssets = false,
  l,
  onDetailStateChange,
  registerDetailBridgeApi,
}) {
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailFixedAssetRows, setDetailFixedAssetRows] = useState([]);
  const detailRequestRef = useRef(0);

  const selectedResolvedDetail = useMemo(() => {
    const activeDocumentId = toPositiveInt(selectedDocumentId);
    const loadedDetailId = toPositiveInt(selectedDetail?.id);
    if (!activeDocumentId || !loadedDetailId || activeDocumentId !== loadedDetailId) {
      return null;
    }
    return selectedDetail;
  }, [selectedDetail, selectedDocumentId]);

  const selectedDetailForPosting = selectedResolvedDetail;
  const selectedSnapshot = selectedResolvedDetail || shellSelectedSnapshot || null;
  const detailDocumentLegalEntityId = toPositiveInt(
    selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
  );
  const detailRequiresFixedAssetLookup = useMemo(
    () =>
      Array.isArray(selectedSnapshot?.lines) &&
      selectedSnapshot.lines.some((line) => toPositiveInt(line?.targetFixedAssetId)),
    [selectedSnapshot]
  );
  const detailFixedAssetRowsById = useMemo(
    () => buildRowsById(detailFixedAssetRows),
    [detailFixedAssetRows]
  );

  const applyMutationResultRow = useCallback(
    (responseRow) => {
      const activeDocumentId = toPositiveInt(selectedDocumentId);
      const responseRowId = toPositiveInt(responseRow?.id);
      if (!activeDocumentId || !responseRowId || activeDocumentId !== responseRowId) {
        return false;
      }
      setSelectedDetail(responseRow);
      setDetailError("");
      return true;
    },
    [selectedDocumentId]
  );

  useEffect(() => {
    if (typeof registerDetailBridgeApi !== "function") {
      return undefined;
    }
    registerDetailBridgeApi({ applyMutationResultRow });
    return () => {
      registerDetailBridgeApi(null);
    };
  }, [applyMutationResultRow, registerDetailBridgeApi]);

  useEffect(() => {
    if (typeof onDetailStateChange !== "function") {
      return;
    }
    onDetailStateChange({
      selectedDetail: selectedResolvedDetail || null,
      selectedDetailForPosting: selectedDetailForPosting || null,
    });
  }, [onDetailStateChange, selectedDetailForPosting, selectedResolvedDetail]);

  useEffect(() => {
    const activeDocumentId = toPositiveInt(selectedDocumentId);
    if (!activeDocumentId || !canRead) {
      setSelectedDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }

    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSelectedDetail((previous) =>
      toPositiveInt(previous?.id) === activeDocumentId ? previous : null
    );
    setDetailError("");
    setDetailLoading(true);

    let active = true;
    async function loadDocumentDetail() {
      try {
        const response = await getCariDocument(activeDocumentId);
        if (!active || detailRequestRef.current !== requestId) {
          return;
        }
        setSelectedDetail(response?.row || null);
      } catch (error) {
        if (!active || detailRequestRef.current !== requestId) {
          return;
        }
        setSelectedDetail(null);
        setDetailError(
          normalizeApiError(
            error,
            l("Failed to load document detail.", "Belge detayi yuklenemedi.")
          )
        );
      } finally {
        if (active && detailRequestRef.current === requestId) {
          setDetailLoading(false);
        }
      }
    }

    loadDocumentDetail();
    return () => {
      active = false;
    };
  }, [canRead, detailRefreshToken, l, selectedDocumentId]);

  useEffect(() => {
    if (
      !canReadFixedAssets ||
      !detailDocumentLegalEntityId ||
      !detailRequiresFixedAssetLookup
    ) {
      setDetailFixedAssetRows([]);
      return;
    }

    let active = true;
    async function loadDetailFixedAssetRows() {
      try {
        const uniqueStatuses = [...new Set([
          "DRAFT",
          ...FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES,
          ...FIXED_ASSET_AR_ELIGIBLE_STATUSES,
        ])];
        const responses = await Promise.all(
          uniqueStatuses.map((status) =>
            listFixedAssets({
              legalEntityId: detailDocumentLegalEntityId,
              status,
              limit: 500,
              offset: 0,
            }).catch(() => ({ rows: [] }))
          )
        );
        if (!active) {
          return;
        }
        const mergedRows = [];
        const seenIds = new Set();
        for (const response of responses) {
          for (const row of Array.isArray(response?.rows) ? response.rows : []) {
            const rowId = toPositiveInt(row?.id);
            if (!rowId || seenIds.has(rowId)) {
              continue;
            }
            seenIds.add(rowId);
            mergedRows.push(row);
          }
        }
        setDetailFixedAssetRows(mergedRows);
      } catch {
        if (active) {
          setDetailFixedAssetRows([]);
        }
      }
    }

    loadDetailFixedAssetRows();
    return () => {
      active = false;
    };
  }, [
    canReadFixedAssets,
    detailDocumentLegalEntityId,
    detailRefreshToken,
    detailRequiresFixedAssetLookup,
  ]);

  return {
    selectedDetail: selectedResolvedDetail,
    selectedDetailForPosting,
    selectedSnapshot,
    detailLoading,
    detailError,
    detailFixedAssetRowsById,
  };
}
