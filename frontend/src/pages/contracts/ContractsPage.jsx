import { useEffect, useMemo, useState } from "react";
import { listAccounts } from "../../api/glAdmin.js";
import {
  activateContract,
  cancelContract,
  closeContract,
  createContract,
  getContract,
  linkContractDocument,
  listContractDocuments,
  listContracts,
  suspendContract,
  updateContract,
} from "../../api/contracts.js";
import { listCariCounterparties } from "../../api/cariCounterparty.js";
import { listCariDocuments } from "../../api/cariDocuments.js";
import { useAuth } from "../../auth/useAuth.js";
import {
  CONTRACT_LINE_STATUSES,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  LINK_TYPES,
  RECOGNITION_METHODS,
  buildContractLinkPayload,
  buildContractListQuery,
  createEmptyContractLine,
  createInitialContractForm,
  createInitialLinkForm,
  filterAccountsForContractRole,
  formatAmount,
  getCounterpartyRoleForContractType,
  getDocumentDirectionForContractType,
  getLifecycleActionStates,
  mapContractDetailToForm,
  resolveContractsPermissionGates,
  toPositiveInt,
  validateContractForm,
  validateContractLinkForm,
} from "./contractsUtils.js";

const DEFAULT_FILTERS = {
  legalEntityId: "",
  counterpartyId: "",
  contractType: "",
  status: "",
  q: "",
  limit: 100,
  offset: 0,
};

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.message || error?.response?.data?.message || fallback).trim();
  const requestId = String(error?.requestId || error?.response?.data?.requestId || "").trim();
  return requestId ? `${message || fallback} (requestId: ${requestId})` : message || fallback;
}

export default function ContractsPage() {
  const { permissions } = useAuth();
  const gates = useMemo(() => resolveContractsPermissionGates(permissions), [permissions]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [selectedContractId, setSelectedContractId] = useState(null);
  const [selectedContractDetail, setSelectedContractDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [documentLinks, setDocumentLinks] = useState([]);
  const [linksError, setLinksError] = useState("");

  const [formMode, setFormMode] = useState("create");
  const [contractForm, setContractForm] = useState(() => createInitialContractForm());
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");

  const [lifecycleLoading, setLifecycleLoading] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleMessage, setLifecycleMessage] = useState("");

  const [linkForm, setLinkForm] = useState(() => createInitialLinkForm());
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkMessage, setLinkMessage] = useState("");

  const [counterpartyOptions, setCounterpartyOptions] = useState([]);
  const [accountOptions, setAccountOptions] = useState([]);
  const [documentPickerRows, setDocumentPickerRows] = useState([]);

  const selectedContractRow = useMemo(
    () => rows.find((row) => Number(row?.id || 0) === Number(selectedContractId || 0)) || null,
    [rows, selectedContractId]
  );
  const selectedContract = selectedContractDetail || selectedContractRow;
  const lifecycleStates = useMemo(
    () => getLifecycleActionStates(selectedContract?.status, gates),
    [selectedContract?.status, gates]
  );

  const canEditSelected = gates.canUpsertContract && toUpper(selectedContract?.status) === "DRAFT";
  const selectedLegalEntityId =
    toPositiveInt(selectedContract?.legalEntityId) || toPositiveInt(contractForm.legalEntityId) || null;
  const selectedType = toUpper(selectedContract?.contractType || contractForm.contractType);

  const deferredAccountOptions = useMemo(
    () => filterAccountsForContractRole(accountOptions, contractForm.contractType, "deferred"),
    [accountOptions, contractForm.contractType]
  );
  const revenueAccountOptions = useMemo(
    () => filterAccountsForContractRole(accountOptions, contractForm.contractType, "revenue"),
    [accountOptions, contractForm.contractType]
  );

  async function loadContracts(nextFilters = filters) {
    if (!gates.canReadContractsRoute) {
      setRows([]);
      setTotalRows(0);
      setListError("Missing permission: contract.read");
      return;
    }
    setListLoading(true);
    setListError("");
    try {
      const response = await listContracts(buildContractListQuery(nextFilters));
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setTotalRows(Number(response?.total || 0));
    } catch (error) {
      setRows([]);
      setTotalRows(0);
      setListError(normalizeApiError(error, "Failed to load contracts."));
    } finally {
      setListLoading(false);
    }
  }

  async function loadContractDetail(contractId) {
    if (!gates.canReadContractsRoute || !toPositiveInt(contractId)) {
      setSelectedContractDetail(null);
      setDocumentLinks([]);
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    setLinksError("");
    try {
      const [detailResponse, linksResponse] = await Promise.all([
        getContract(contractId),
        listContractDocuments(contractId),
      ]);
      setSelectedContractDetail(detailResponse?.row || null);
      setDocumentLinks(Array.isArray(linksResponse?.rows) ? linksResponse.rows : []);
    } catch (error) {
      const message = normalizeApiError(error, "Failed to load contract detail.");
      setSelectedContractDetail(null);
      setDocumentLinks([]);
      setDetailError(message);
      setLinksError(message);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadContracts(DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gates.canReadContractsRoute]);

  useEffect(() => {
    if (!toPositiveInt(selectedContractId)) {
      setSelectedContractDetail(null);
      setDocumentLinks([]);
      return;
    }
    loadContractDetail(selectedContractId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContractId, gates.canReadContractsRoute]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(contractForm.legalEntityId);
    if (!gates.shouldFetchCounterparties || !legalEntityId) {
      setCounterpartyOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role: getCounterpartyRoleForContractType(contractForm.contractType),
          status: "ACTIVE",
          limit: 100,
          offset: 0,
        });
        if (!cancelled) {
          setCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (!cancelled) {
          setCounterpartyOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractForm.contractType, contractForm.legalEntityId, gates.shouldFetchCounterparties]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(contractForm.legalEntityId);
    if (!gates.shouldFetchAccounts || !legalEntityId) {
      setAccountOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await listAccounts({ legalEntityId, includeInactive: false, limit: 600 });
        if (!cancelled) {
          setAccountOptions(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (!cancelled) {
          setAccountOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractForm.legalEntityId, gates.shouldFetchAccounts]);

  useEffect(() => {
    if (!gates.shouldFetchDocuments || !toPositiveInt(selectedContractId) || !selectedLegalEntityId) {
      setDocumentPickerRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await listCariDocuments({
          legalEntityId: selectedLegalEntityId,
          direction: getDocumentDirectionForContractType(selectedType),
          status: "POSTED",
          limit: 100,
          offset: 0,
        });
        if (!cancelled) {
          setDocumentPickerRows(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (!cancelled) {
          setDocumentPickerRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gates.shouldFetchDocuments, selectedContractId, selectedLegalEntityId, selectedType]);

  function handleStartCreate() {
    setFormMode("create");
    setContractForm(createInitialContractForm());
    setSelectedContractId(null);
    setSelectedContractDetail(null);
    setDocumentLinks([]);
    setFormError("");
    setFormMessage("");
  }

  function handleLoadSelectedForEdit() {
    if (!selectedContract) {
      setFormError("Select a contract first.");
      return;
    }
    setFormMode("edit");
    setContractForm(mapContractDetailToForm(selectedContract));
    setFormError("");
    setFormMessage("");
  }

  function handleLineChange(index, field, value) {
    setContractForm((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      if (!lines[index]) {
        return prev;
      }
      lines[index] = { ...lines[index], [field]: value };
      return { ...prev, lines };
    });
  }

  function addLine() {
    setContractForm((prev) => ({
      ...prev,
      lines: [...(Array.isArray(prev.lines) ? prev.lines : []), createEmptyContractLine()],
    }));
  }

  function removeLine(index) {
    setContractForm((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      if (lines.length <= 1) {
        return prev;
      }
      lines.splice(index, 1);
      return { ...prev, lines };
    });
  }

  async function handleSubmitContract(event) {
    event.preventDefault();
    if (!gates.canUpsertContract) {
      setFormError("Missing permission: contract.upsert");
      return;
    }

    setFormSaving(true);
    setFormError("");
    setFormMessage("");
    try {
      const { payload, errors } = validateContractForm(contractForm);
      if (errors.length > 0) {
        setFormError(errors.join(" "));
        return;
      }

      if (formMode === "edit") {
        const contractId = toPositiveInt(selectedContractId);
        if (!contractId || !canEditSelected) {
          setFormError("Only selected DRAFT contracts can be edited.");
          return;
        }
        await updateContract(contractId, payload);
        setFormMessage("Contract updated.");
        await Promise.all([loadContracts(filters), loadContractDetail(contractId)]);
      } else {
        const response = await createContract(payload);
        const createdId = toPositiveInt(response?.row?.id);
        setFormMessage(`Contract created. id=${createdId || "-"}`);
        if (createdId) {
          setSelectedContractId(createdId);
        }
        await loadContracts(filters);
      }
    } catch (error) {
      setFormError(normalizeApiError(error, "Failed to save contract."));
    } finally {
      setFormSaving(false);
    }
  }

  async function handleLifecycleAction(action) {
    const contractId = toPositiveInt(selectedContractId);
    if (!contractId) {
      setLifecycleError("Select a contract first.");
      return;
    }

    const actionState = lifecycleStates?.[action];
    if (!actionState?.allowed) {
      setLifecycleError(actionState?.reason || `Action ${action} is not allowed.`);
      return;
    }

    setLifecycleLoading(action);
    setLifecycleError("");
    setLifecycleMessage("");
    try {
      if (action === "activate") {
        await activateContract(contractId);
      } else if (action === "suspend") {
        await suspendContract(contractId);
      } else if (action === "close") {
        await closeContract(contractId);
      } else if (action === "cancel") {
        await cancelContract(contractId);
      }
      setLifecycleMessage(`Contract ${action} action completed.`);
      await Promise.all([loadContracts(filters), loadContractDetail(contractId)]);
    } catch (error) {
      setLifecycleError(normalizeApiError(error, `Failed to ${action} contract.`));
    } finally {
      setLifecycleLoading("");
    }
  }

  async function handleLinkDocument(event) {
    event.preventDefault();
    const contractId = toPositiveInt(selectedContractId);
    if (!contractId) {
      setLinkError("Select a contract first.");
      return;
    }
    if (!gates.canLinkDocument) {
      setLinkError("Missing permission: contract.link_document");
      return;
    }

    setLinkSaving(true);
    setLinkError("");
    setLinkMessage("");
    try {
      const { payload, errors } = validateContractLinkForm(linkForm);
      if (errors.length > 0) {
        setLinkError(errors.join(" "));
        return;
      }
      await linkContractDocument(contractId, buildContractLinkPayload(payload));
      setLinkMessage("Document linked.");
      setLinkForm(createInitialLinkForm());
      await loadContractDetail(contractId);
    } catch (error) {
      setLinkError(normalizeApiError(error, "Failed to link document."));
    } finally {
      setLinkSaving(false);
    }
  }

  if (!gates.canReadContractsRoute) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: <code>contract.read</code>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Contracts</h1>
        {!gates.canReadCounterpartyPicker ? (
          <p className="mt-1 text-xs text-amber-700">Picker disabled: cari.card.read</p>
        ) : null}
        {!gates.canReadAccountPicker ? (
          <p className="mt-1 text-xs text-amber-700">Picker disabled: gl.account.read</p>
        ) : null}
        {!gates.canReadDocumentPicker ? (
          <p className="mt-1 text-xs text-amber-700">Picker disabled: cari.doc.read</p>
        ) : null}

        {listError ? <div className="mt-2 text-sm text-rose-700">{listError}</div> : null}
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="legalEntityId"
            value={filters.legalEntityId}
            onChange={(event) => setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))}
          />
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="counterpartyId"
            value={filters.counterpartyId}
            onChange={(event) => setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))}
          />
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={filters.contractType}
            onChange={(event) => setFilters((prev) => ({ ...prev, contractType: event.target.value }))}
          >
            <option value="">ALL TYPES</option>
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">ALL STATUS</option>
            {CONTRACT_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="search"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={() => loadContracts(filters)} disabled={listLoading}>
            {listLoading ? "Loading..." : "Refresh"}
          </button>
          <button className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={handleStartCreate}>New</button>
          <button className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={handleLoadSelectedForEdit} disabled={!selectedContract}>Edit Selected</button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-600">Total contracts: {totalRows}</div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th>ID</th><th>No</th><th>Type</th><th>Status</th><th>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-200">
                  <td>{row.id}</td>
                  <td>{row.contractNo}</td>
                  <td>{row.contractType}</td>
                  <td>{row.status}</td>
                  <td>{formatAmount(row.totalAmountBase)}</td>
                  <td>
                    <button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setSelectedContractId(row.id)}>
                      Select
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="py-3 text-slate-500">No rows.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">{formMode === "edit" ? "Edit Draft" : "Create Draft"}</h2>
        {formError ? <div className="mt-2 text-sm text-rose-700">{formError}</div> : null}
        {formMessage ? <div className="mt-2 text-sm text-emerald-700">{formMessage}</div> : null}

        <form className="mt-3 space-y-3" onSubmit={handleSubmitContract}>
          <div className="grid gap-2 md:grid-cols-4">
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="legalEntityId" value={contractForm.legalEntityId} onChange={(event) => setContractForm((prev) => ({ ...prev, legalEntityId: event.target.value }))} />
            {gates.canReadCounterpartyPicker ? (
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={contractForm.counterpartyId} onChange={(event) => setContractForm((prev) => ({ ...prev, counterpartyId: event.target.value }))}>
                <option value="">counterparty</option>
                {counterpartyOptions.map((row) => <option key={row.id} value={row.id}>{row.code || row.id} - {row.name || "-"}</option>)}
              </select>
            ) : (
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="counterpartyId" value={contractForm.counterpartyId} onChange={(event) => setContractForm((prev) => ({ ...prev, counterpartyId: event.target.value }))} />
            )}
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="contractNo" value={contractForm.contractNo} onChange={(event) => setContractForm((prev) => ({ ...prev, contractNo: event.target.value }))} />
            <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={contractForm.contractType} onChange={(event) => setContractForm((prev) => ({ ...prev, contractType: event.target.value }))}>
              {CONTRACT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="currencyCode" value={contractForm.currencyCode} onChange={(event) => setContractForm((prev) => ({ ...prev, currencyCode: event.target.value }))} />
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={contractForm.startDate} onChange={(event) => setContractForm((prev) => ({ ...prev, startDate: event.target.value }))} />
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={contractForm.endDate} onChange={(event) => setContractForm((prev) => ({ ...prev, endDate: event.target.value }))} />
            <input className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-4" placeholder="notes" value={contractForm.notes} onChange={(event) => setContractForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </div>

          <div className="space-y-2 rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Lines</div>
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={addLine}>Add line</button>
            </div>
            {(Array.isArray(contractForm.lines) ? contractForm.lines : []).map((line, index) => (
              <div key={`line-${index}`} className="grid gap-2 md:grid-cols-5">
                <input className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-2" placeholder="description" value={line.description} onChange={(event) => handleLineChange(index, "description", event.target.value)} />
                <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="amountTxn" value={line.lineAmountTxn} onChange={(event) => handleLineChange(index, "lineAmountTxn", event.target.value)} />
                <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="amountBase" value={line.lineAmountBase} onChange={(event) => handleLineChange(index, "lineAmountBase", event.target.value)} />
                <button type="button" className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700" onClick={() => removeLine(index)} disabled={(contractForm.lines || []).length <= 1}>Remove</button>

                <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.recognitionMethod} onChange={(event) => handleLineChange(index, "recognitionMethod", event.target.value)}>
                  {RECOGNITION_METHODS.map((method) => <option key={`${index}-${method}`} value={method}>{method}</option>)}
                </select>
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.recognitionStartDate} onChange={(event) => handleLineChange(index, "recognitionStartDate", event.target.value)} />
                <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.recognitionEndDate} onChange={(event) => handleLineChange(index, "recognitionEndDate", event.target.value)} />
                <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.status} onChange={(event) => handleLineChange(index, "status", event.target.value)}>
                  {CONTRACT_LINE_STATUSES.map((status) => <option key={`${index}-${status}`} value={status}>{status}</option>)}
                </select>

                {gates.canReadAccountPicker ? (
                  <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.deferredAccountId} onChange={(event) => handleLineChange(index, "deferredAccountId", event.target.value)}>
                    <option value="">deferred account</option>
                    {deferredAccountOptions.map((row) => <option key={`d-${index}-${row.id}`} value={row.id}>{row.code} - {row.name}</option>)}
                  </select>
                ) : (
                  <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="deferredAccountId" value={line.deferredAccountId} onChange={(event) => handleLineChange(index, "deferredAccountId", event.target.value)} />
                )}

                {gates.canReadAccountPicker ? (
                  <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={line.revenueAccountId} onChange={(event) => handleLineChange(index, "revenueAccountId", event.target.value)}>
                    <option value="">revenue/expense account</option>
                    {revenueAccountOptions.map((row) => <option key={`r-${index}-${row.id}`} value={row.id}>{row.code} - {row.name}</option>)}
                  </select>
                ) : (
                  <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="revenueAccountId" value={line.revenueAccountId} onChange={(event) => handleLineChange(index, "revenueAccountId", event.target.value)} />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white" disabled={formSaving || !gates.canUpsertContract}>
              {formSaving ? "Saving..." : formMode === "edit" ? "Update" : "Create"}
            </button>
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={handleStartCreate}>Reset</button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Lifecycle</h2>
        {detailError ? <div className="mt-2 text-sm text-rose-700">{detailError}</div> : null}
        {lifecycleError ? <div className="mt-2 text-sm text-rose-700">{lifecycleError}</div> : null}
        {lifecycleMessage ? <div className="mt-2 text-sm text-emerald-700">{lifecycleMessage}</div> : null}
        {selectedContract ? (
          <div className="mt-3 space-y-2">
            <div className="text-sm text-slate-700">
              #{selectedContract.id} | {selectedContract.contractNo} | {selectedContract.status}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleLifecycleAction("activate")} disabled={!lifecycleStates.activate.allowed || lifecycleLoading === "activate"}>{lifecycleLoading === "activate" ? "..." : "Activate"}</button>
              <button className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleLifecycleAction("suspend")} disabled={!lifecycleStates.suspend.allowed || lifecycleLoading === "suspend"}>{lifecycleLoading === "suspend" ? "..." : "Suspend"}</button>
              <button className="rounded bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleLifecycleAction("close")} disabled={!lifecycleStates.close.allowed || lifecycleLoading === "close"}>{lifecycleLoading === "close" ? "..." : "Close"}</button>
              <button className="rounded bg-rose-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleLifecycleAction("cancel")} disabled={!lifecycleStates.cancel.allowed || lifecycleLoading === "cancel"}>{lifecycleLoading === "cancel" ? "..." : "Cancel"}</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">{detailLoading ? "Loading..." : "Select a contract."}</div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Link Document</h2>
        {linksError ? <div className="mt-2 text-sm text-rose-700">{linksError}</div> : null}
        {linkError ? <div className="mt-2 text-sm text-rose-700">{linkError}</div> : null}
        {linkMessage ? <div className="mt-2 text-sm text-emerald-700">{linkMessage}</div> : null}

        {!selectedContract ? (
          <p className="mt-2 text-sm text-slate-500">Select a contract first.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {!gates.canReadDocumentPicker ? (
              <div className="text-xs text-amber-700">Picker hidden: cari.doc.read missing.</div>
            ) : null}
            <form className="grid gap-2 md:grid-cols-4" onSubmit={handleLinkDocument}>
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="cariDocumentId" value={linkForm.cariDocumentId} onChange={(event) => setLinkForm((prev) => ({ ...prev, cariDocumentId: event.target.value }))} />
              {gates.canReadDocumentPicker ? (
                <select className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-3" value="" onChange={(event) => setLinkForm((prev) => ({ ...prev, cariDocumentId: event.target.value }))}>
                  <option value="">picker documents</option>
                  {documentPickerRows.map((row) => <option key={row.id} value={row.id}>{row.documentNo || row.id} | {row.direction} | {row.status}</option>)}
                </select>
              ) : null}
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={linkForm.linkType} onChange={(event) => setLinkForm((prev) => ({ ...prev, linkType: event.target.value }))}>
                {LINK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="linkedAmountTxn" value={linkForm.linkedAmountTxn} onChange={(event) => setLinkForm((prev) => ({ ...prev, linkedAmountTxn: event.target.value }))} />
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="linkedAmountBase" value={linkForm.linkedAmountBase} onChange={(event) => setLinkForm((prev) => ({ ...prev, linkedAmountBase: event.target.value }))} />
              <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-60" disabled={!gates.canLinkDocument || linkSaving}>
                {linkSaving ? "Linking..." : "Link"}
              </button>
            </form>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr><th>Document</th><th>Type</th><th>Txn</th><th>Base</th></tr>
                </thead>
                <tbody>
                  {documentLinks.map((row, index) => (
                    <tr key={`link-${index}`} className="border-t border-slate-200">
                      <td>{row.documentNo || row.cariDocumentId}</td>
                      <td>{row.linkType}</td>
                      <td>{formatAmount(row.linkedAmountTxn)}</td>
                      <td>{formatAmount(row.linkedAmountBase)}</td>
                    </tr>
                  ))}
                  {documentLinks.length === 0 ? (
                    <tr><td colSpan={4} className="py-2 text-slate-500">No links.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
