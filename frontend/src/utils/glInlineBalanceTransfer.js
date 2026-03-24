import {
  createBalanceSplitReclassification,
  getTrialBalance,
  listBooks,
  postJournal,
} from "../api/glAdmin.js";
import { listFiscalPeriods } from "../api/orgAdmin.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toUpper(value) {
  return normalizeText(value).toUpperCase();
}

function toIsoLocalDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickDefaultPeriod(periodRows = [], todayIso = toIsoLocalDate()) {
  const rows = Array.isArray(periodRows) ? [...periodRows] : [];
  if (rows.length === 0) {
    return null;
  }
  const today = normalizeText(todayIso);
  const todayMatch = rows.find((row) => {
    const start = normalizeText(row?.start_date || row?.startDate);
    const end = normalizeText(row?.end_date || row?.endDate);
    return start && end && start <= today && end >= today;
  });
  if (todayMatch) {
    return todayMatch;
  }
  const openMatch = rows.find(
    (row) => toUpper(row?.status) === "OPEN" || toUpper(row?.period_status) === "OPEN"
  );
  if (openMatch) {
    return openMatch;
  }
  return rows[rows.length - 1] || null;
}

function pickEntryDateForPeriod(period, todayIso = toIsoLocalDate()) {
  const today = normalizeText(todayIso);
  const start = normalizeText(period?.start_date || period?.startDate);
  const end = normalizeText(period?.end_date || period?.endDate);
  if (!start || !end) {
    return today || toIsoLocalDate();
  }
  if (today && today >= start && today <= end) {
    return today;
  }
  if (today && today < start) {
    return start;
  }
  return end;
}

export async function maybePromptParentBalanceTransferAfterChildCreate({
  l = (en) => en,
  legalEntityId,
  parentAccount,
  childAccountId,
  childCode,
  childName,
  accountPool = [],
  canCreateJournals = false,
  canPostJournals = false,
  canReadBooks = false,
  canReadFiscalPeriods = false,
  canReadTrialBalance = false,
}) {
  const normalizedLegalEntityId = toPositiveInt(legalEntityId);
  const parentAccountId = toPositiveInt(parentAccount?.id);
  const normalizedChildAccountId = toPositiveInt(childAccountId);
  if (!normalizedLegalEntityId || !parentAccountId || !normalizedChildAccountId) {
    return null;
  }

  if (!canCreateJournals) {
    return {
      message: l(
        "Account saved. Balance transfer prompt skipped (missing permission: gl.journal.create).",
        "Hesap kaydedildi. Bakiye aktarim adimi atlandi (eksik yetki: gl.journal.create)."
      ),
    };
  }
  if (!canReadBooks || !canReadFiscalPeriods || !canReadTrialBalance) {
    return {
      message: l(
        "Account saved. Balance transfer prompt skipped (book/period/trial balance read permission missing).",
        "Hesap kaydedildi. Bakiye aktarim adimi atlandi (defter/period/mizan okuma yetkisi eksik)."
      ),
    };
  }

  const booksResponse = await listBooks({ legalEntityId: normalizedLegalEntityId });
  const books = Array.isArray(booksResponse?.rows) ? booksResponse.rows : [];
  const preferredBook =
    books.find((book) => toUpper(book?.book_type || book?.bookType) === "LOCAL") ||
    books[0] ||
    null;
  const bookId = toPositiveInt(preferredBook?.id);
  const calendarId = toPositiveInt(preferredBook?.calendar_id || preferredBook?.calendarId);
  if (!bookId || !calendarId) {
    return {
      message: l(
        "Account saved. Book/calendar resolution failed for automatic balance transfer.",
        "Hesap kaydedildi. Otomatik bakiye aktarimi icin defter/takvim cozumlenemedi."
      ),
    };
  }

  const periodResponse = await listFiscalPeriods(calendarId);
  const periodRows = Array.isArray(periodResponse?.rows) ? periodResponse.rows : [];
  const selectedPeriod = pickDefaultPeriod(periodRows);
  const fiscalPeriodId = toPositiveInt(selectedPeriod?.id);
  if (!fiscalPeriodId) {
    return {
      message: l(
        "Account saved. No fiscal period found to evaluate parent balance transfer.",
        "Hesap kaydedildi. Parent bakiye aktarimini degerlendirmek icin fiscal period bulunamadi."
      ),
    };
  }

  const trialBalance = await getTrialBalance({
    bookId,
    fiscalPeriodId,
    includeRollup: true,
  });
  const trialRows = Array.isArray(trialBalance?.rows) ? trialBalance.rows : [];
  const parentBalanceRow =
    trialRows.find((row) => toPositiveInt(row?.account_id) === parentAccountId) || null;
  const directBalance = Number(
    parentBalanceRow?.direct_balance ?? parentBalanceRow?.balance ?? 0
  );
  if (!Number.isFinite(directBalance) || Math.abs(directBalance) <= 0.0001) {
    return null;
  }

  const baseCurrencyCode =
    toUpper(preferredBook?.base_currency_code || preferredBook?.baseCurrencyCode) ||
    "USD";
  const periodLabel = `${selectedPeriod?.fiscal_year || ""}/${selectedPeriod?.period_no || ""} ${
    selectedPeriod?.period_name || ""
  }`.trim();
  const parentCode = toUpper(parentAccount?.code) || String(parentAccountId);
  const parentName = normalizeText(parentAccount?.name);
  const formattedBalance = `${directBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${baseCurrencyCode}`;

  const choiceRaw = window.prompt(
    l(
      `Parent account ${parentCode}${parentName ? ` - ${parentName}` : ""} has direct balance ${formattedBalance} in ${preferredBook?.code || bookId} (${periodLabel || fiscalPeriodId}). Choose: 1=Keep on parent, 2=Move all to new child ${childCode}, 3=Move all to another account.`,
      `Parent hesap ${parentCode}${parentName ? ` - ${parentName}` : ""} icin ${preferredBook?.code || bookId} (${periodLabel || fiscalPeriodId}) doneminde direkt bakiye ${formattedBalance}. Secim yapin: 1=Parentta kalsin, 2=Tamamini yeni alt hesaba (${childCode}) aktar, 3=Tamamini baska hesaba aktar.`
    ),
    "2"
  );
  const choice = normalizeText(choiceRaw).toUpperCase();
  if (!choice || choice === "1") {
    return null;
  }
  if (choice !== "2" && choice !== "3") {
    throw new Error(
      l(
        "Invalid transfer choice. Use 1, 2, or 3.",
        "Gecersiz aktarim secimi. 1, 2 veya 3 kullanin."
      )
    );
  }

  const normalizedAccountPool = Array.isArray(accountPool) ? [...accountPool] : [];
  if (
    !normalizedAccountPool.some(
      (row) => toPositiveInt(row?.id) === normalizedChildAccountId
    )
  ) {
    normalizedAccountPool.push({
      id: normalizedChildAccountId,
      code: childCode,
      name: childName,
    });
  }
  const accountsById = new Map();
  const accountsByCode = new Map();
  for (const row of normalizedAccountPool) {
    const accountId = toPositiveInt(row?.id);
    const accountCode = toUpper(row?.code);
    if (accountId && !accountsById.has(accountId)) {
      accountsById.set(accountId, row);
    }
    if (accountCode && !accountsByCode.has(accountCode)) {
      accountsByCode.set(accountCode, row);
    }
  }

  let targetAccount = accountsById.get(normalizedChildAccountId) || null;
  if (choice === "3") {
    const targetRaw = window.prompt(
      l(
        "Enter target account code or account id.",
        "Hedef hesap kodu veya hesap id girin."
      ),
      ""
    );
    const targetKey = normalizeText(targetRaw);
    const targetId = toPositiveInt(targetKey);
    targetAccount =
      (targetId ? accountsById.get(targetId) : null) ||
      accountsByCode.get(toUpper(targetKey)) ||
      null;
    if (!targetAccount) {
      throw new Error(
        l(
          "Target account not found in selected CoA.",
          "Secili hesap planinda hedef hesap bulunamadi."
        )
      );
    }
  }

  const targetAccountId = toPositiveInt(targetAccount?.id);
  if (!targetAccountId || targetAccountId === parentAccountId) {
    throw new Error(
      l(
        "Target account must be different from parent account.",
        "Hedef hesap parent hesaptan farkli olmalidir."
      )
    );
  }

  const targetCode = toUpper(targetAccount?.code) || String(targetAccountId);
  const targetName = normalizeText(targetAccount?.name);
  const confirmProceed = window.confirm(
    l(
      `Create balance transfer journal now?\nSource: ${parentCode}\nTarget: ${targetCode}${targetName ? ` - ${targetName}` : ""}\nAmount: ${formattedBalance}\nBook: ${preferredBook?.code || bookId}\nPeriod: ${periodLabel || fiscalPeriodId}`,
      `Bakiye aktarim fisini simdi olusturulsun mu?\nKaynak: ${parentCode}\nHedef: ${targetCode}${targetName ? ` - ${targetName}` : ""}\nTutar: ${formattedBalance}\nDefter: ${preferredBook?.code || bookId}\nDonem: ${periodLabel || fiscalPeriodId}`
    )
  );
  if (!confirmProceed) {
    return null;
  }

  const entryDate = pickEntryDateForPeriod(selectedPeriod, toIsoLocalDate());
  const reclassResult = await createBalanceSplitReclassification({
    legalEntityId: normalizedLegalEntityId,
    bookId,
    fiscalPeriodId,
    sourceAccountId: parentAccountId,
    entryDate,
    documentDate: entryDate,
    currencyCode: baseCurrencyCode,
    allocationMode: "PERCENT",
    description: l(
      `Subaccount balance transfer ${parentCode} -> ${targetCode}`,
      `Alt hesap bakiye aktarimi ${parentCode} -> ${targetCode}`
    ),
    note: l(
      `Triggered after creating child ${childCode}`,
      `${childCode} alt hesap olusturma sonrasi tetiklendi`
    ),
    targets: [
      {
        accountId: targetAccountId,
        percentage: 100,
      },
    ],
  });
  const journalEntryId = toPositiveInt(reclassResult?.journalEntryId);
  if (!journalEntryId) {
    throw new Error("Failed to resolve reclassification journal id");
  }

  if (canPostJournals) {
    await postJournal(journalEntryId);
    return {
      message: l(
        `Parent balance moved to ${targetCode}. Journal #${journalEntryId} posted.`,
        `Parent bakiye ${targetCode} hesabina tasindi. Fis #${journalEntryId} post edildi.`
      ),
    };
  }

  return {
    message: l(
      `Balance transfer draft created (#${journalEntryId}). Missing permission to post (gl.journal.post).`,
      `Bakiye aktarim taslagi olusturuldu (#${journalEntryId}). Post etmek icin yetki eksik (gl.journal.post).`
    ),
  };
}
