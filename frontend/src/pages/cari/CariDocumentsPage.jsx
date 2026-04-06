import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useCallback } from "react";
import {
  cancelCariDocument,
  getCariDocument,
} from "../../api/cariDocuments.js";
import { createFixedAsset } from "../../api/fixedAssets.js";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import CariDocumentsCreateSection from "./components/CariDocumentsCreateSection.jsx";
import CariDocumentsDetailSection from "./components/CariDocumentsDetailSection.jsx";
import CariDocumentsListSection from "./components/CariDocumentsListSection.jsx";
import FixedAssetCategorySetupModal from "./components/FixedAssetCategorySetupModal.jsx";
import FixedAssetQuickCreateModal from "./components/FixedAssetQuickCreateModal.jsx";
import InlineFixedAssetCategoryCreateModal from "./components/InlineFixedAssetCategoryCreateModal.jsx";
import {
  DOCUMENT_DIRECTIONS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from "./cariDocumentsUtils.js";
import {
  toPositiveInt,
  normalizeText,
  normalizeCurrencyCode,
  getFixedAssetCategorySetupIssue,
  formatFixedAssetCategorySetupRequirementList,
  createInitialQuickCreateFixedAssetForm,
  DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
  FIXED_ASSET_AR_ELIGIBLE_STATUSES,
  FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES,
  DOCUMENT_RECURRING_TEMPLATE_CADENCES,
  buildFixedAssetSaleCreatePrefill,
  clearFixedAssetSaleCreatePrefill,
  buildRowsById,
  normalizeApiError,
  isDraft,
  resolveRouteFixedDirection,
  getDocumentPageTitle,
} from "./cariDocumentsPageHelpers.js";

/**
 * Coordinates the split CARI document workbench domains and cross-domain bridges.
 */
export default function CariDocumentsPage({ direction = "" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fixedRouteDirection = useMemo(
    () => resolveRouteFixedDirection(direction, searchParams),
    [direction, searchParams]
  );
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const translateDocumentMutationError = useCallback((message) => {
    const trimmedMessage = String(message || "").trim();
    const coreMessage = trimmedMessage.replace(/^lines\[\d+\]\./, "");
    switch (trimmedMessage) {
      case "legalEntityId is required.":
        return l("legalEntityId is required.", "legalEntityId zorunludur.");
      case "counterpartyId is required.":
        return l("counterpartyId is required.", "counterpartyId zorunludur.");
      case "direction must be AR or AP.":
        return l("direction must be AR or AP.", "direction AR veya AP olmali.");
      case "documentType is invalid.":
        return l("documentType is invalid.", "documentType gecersiz.");
      case "documentDate is required.":
        return l("documentDate is required.", "documentDate zorunludur.");
      case "settlementMode must be ACCRUAL or IMMEDIATE_CASH":
        return l(
          "settlementMode must be ACCRUAL or IMMEDIATE_CASH.",
          "settlementMode ACCRUAL veya IMMEDIATE_CASH olmali."
        );
      case "settlementCashRegisterId is required when settlementMode=IMMEDIATE_CASH":
        return l(
          "Cash register is required when immediate cash is selected.",
          "Aninda nakit secildiginde kasa zorunludur."
        );
      case "settlementCashRegisterId requires settlementMode=IMMEDIATE_CASH":
        return l(
          "Cash register can only be set when immediate cash is selected.",
          "Kasa yalnizca aninda nakit secildiginde atanabilir."
        );
      case "amountTxn must be > 0.":
        return l("amountTxn must be > 0.", "amountTxn 0'dan buyuk olmali.");
      case "amountBase must be > 0.":
        return l("amountBase must be > 0.", "amountBase 0'dan buyuk olmali.");
      case "fxRate is required when currencyCode differs from legal entity functional currency.":
        return l(
          "fxRate is required when invoice currency differs from the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para biriminden farkliysa fxRate zorunludur."
        );
      case "fxRate must be 1 when currencyCode matches legal entity functional currency":
        return l(
          "fxRate must be 1 when invoice currency matches the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para birimiyle ayniysa fxRate 1 olmalidir."
        );
      case "amountBase must equal amountTxn when currencyCode matches legal entity functional currency":
        return l(
          "Base amount must match invoice amount when invoice currency matches the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para birimiyle ayniysa baz tutar fatura tutarina esit olmalidir."
        );
      case "amountBase must equal amountTxn * fxRate when currencyCode differs from legal entity functional currency":
        return l(
          "Base amount must equal invoice amount x FX rate for foreign-currency invoices.",
          "Yabanci para faturalarda baz tutar, fatura tutari x kur olmalidir."
        );
      case "currencyCode must be a 3-letter code.":
        return l(
          "currencyCode must be a 3-letter code.",
          "currencyCode 3 harfli bir kod olmali."
        );
      case "warehouseCode is read-only; send warehouseId only":
        return l(
          "warehouseCode is read-only; send warehouseId only.",
          "warehouseCode salt okunurdur; yalnizca warehouseId gonderin."
        );
      case "warehouseName is read-only; send warehouseId only":
        return l(
          "warehouseName is read-only; send warehouseId only.",
          "warehouseName salt okunurdur; yalnizca warehouseId gonderin."
        );
      case "warehouseId must belong to legalEntityId":
        return l(
          "Selected warehouse must belong to the same legal entity.",
          "Secili depo ayni tuzel kisilige ait olmalidir."
        );
      case "warehouseId must reference an ACTIVE warehouse":
        return l(
          "Selected warehouse must be active.",
          "Secili depo aktif olmalidir."
        );
      case "fxRate must be > 0 when provided.":
        return l(
          "fxRate must be > 0 when provided.",
          "fxRate girildiginde 0'dan buyuk olmali."
        );
      default: {
        switch (coreMessage) {
          case "quantity must be > 0.":
            return l("Quantity must be greater than 0.", "Miktar 0'dan buyuk olmali.");
          case "lineNetAmountTxn must be > 0.":
            return l("Net amount must be greater than 0.", "Net tutar 0'dan buyuk olmali.");
          case "lineGrossAmountTxn must be > 0.":
            return l("Gross amount must be greater than 0.", "Brut tutar 0'dan buyuk olmali.");
          case "taxCategoryCode is required when lineTaxAmountTxn > 0.":
            return l(
              "Tax category is required when tax amount is greater than 0.",
              "Vergi tutari 0'dan buyukse vergi kategorisi zorunludur."
            );
          case "fixedAssetMode is required for AP FIXED_ASSET lines.":
            return l(
              "Choose an asset mode for AP fixed-asset lines.",
              "AP duran varlik satirlari icin bir varlik modu secin."
            );
          case "targetFixedAssetId must be empty for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Auto-create fixed-asset lines cannot target an existing asset.",
              "Otomatik olusturma duran varlik satirlari mevcut bir varligi hedefleyemez."
            );
          case "quantity must be a whole positive integer for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Auto-create fixed-asset quantity must be a whole positive number.",
              "Otomatik olusturma duran varlik miktari pozitif tam sayi olmalidir."
            );
          case "fixedAssetCategoryId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Asset category is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin varlik kategorisi zorunludur."
            );
          case "fixedAssetOwnerOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Owner OU is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin sahip OB zorunludur."
            );
          case "fixedAssetLocationOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Location OU is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin konum OB zorunludur."
            );
          case "targetFixedAssetId is required for AP FIXED_ASSET LINK_EXISTING lines.":
            return l(
              "Select the draft asset to link on this AP fixed-asset line.",
              "Bu AP duran varlik satirinda baglanacak taslak varligi secin."
            );
          case "quantity must equal 1 for AP FIXED_ASSET LINK_EXISTING lines.":
            return l(
              "Link-existing AP fixed-asset lines must use quantity 1.",
              "Mevcut taslaga baglanan AP duran varlik satirlari miktar 1 kullanmalidir."
            );
          case "targetFixedAssetId is required when fixedAssetMode=IMPROVE_EXISTING.":
            return l(
              "Select the asset to improve on this AP fixed-asset line.",
              "Bu AP duran varlik satirinda iyilestirilecek varligi secin."
            );
          case "quantity must equal 1 when fixedAssetMode=IMPROVE_EXISTING.":
            return l(
              "Improvement lines must use quantity 1.",
              "Iyilestirme satirlari miktar 1 kullanmalidir."
            );
          case "revisedUsefulLifeMonths and lifeExtensionMonths cannot both be provided.":
            return l(
              "Choose either revised useful life or life extension, not both.",
              "Hem revize faydali omur hem omur uzatimi birlikte girilemez."
            );
          case "fixedAssetCategoryId, fixedAssetOwnerOperatingUnitId, and fixedAssetLocationOperatingUnitId are not allowed when fixedAssetMode=IMPROVE_EXISTING.":
            return l(
              "Improvement lines inherit category and operating-unit context from the selected asset.",
              "Iyilestirme satirlari kategori ve operasyon birimi baglamini secili varliktan alir."
            );
          case "revisedUsefulLifeMonths and lifeExtensionMonths are allowed only when fixedAssetMode=IMPROVE_EXISTING.":
            return l(
              "Life revision fields can only be used with Improve Existing mode.",
              "Omur revizyon alanlari yalnizca Mevcut Varligi Iyilestir modunda kullanilabilir."
            );
          case "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING.":
            return l(
              "Improvement effective date can only be used with Improve Existing mode.",
              "Iyilestirme etkinlik tarihi yalnizca Mevcut Varligi Iyilestir modunda kullanilabilir."
            );
          case "improvementEffectiveDate must be a valid ISO date.":
            return l(
              "Enter a valid improvement effective date.",
              "Gecerli bir iyilestirme etkinlik tarihi girin."
            );
          case "improvementEffectiveDate cannot be after documentDate.":
            return l(
              "Improvement effective date cannot be later than the bill document date.",
              "Iyilestirme etkinlik tarihi belge tarihinden daha ileri olamaz."
            );
        case "targetFixedAssetId is required for AR FIXED_ASSET lines.":
            return l(
              "Select the asset being sold on this AR fixed-asset line.",
              "Bu AR duran varlik satirinda satilan varligi secin."
            );
          case "quantity must equal 1 for AR FIXED_ASSET lines.":
            return l(
              "AR fixed-asset lines must use quantity 1.",
              "AR duran varlik satirlari miktar 1 kullanmalidir."
            );
          case "itemCardId is required for STOCK lines.":
            return l(
              "Item card is required for stock lines.",
              "Stok satirlari icin urun karti zorunludur."
            );
          case "stockImpactMode is required for STOCK lines.":
            return l(
              "Stock impact is required for stock lines.",
              "Stok satirlari icin stok etkisi zorunludur."
            );
          case "chargeAllocationMethod is supported only on AP documents":
            return l(
              "Charge allocation is available only on AP documents.",
              "Masraf dagitimi yalnizca AP belgelerinde kullanilabilir."
            );
          case "subledgerType must be NONE when chargeAllocationMethod != NONE":
            return l(
              "Charge lines must stay on the General line type.",
              "Masraf satirlari Genel satir tipinde kalmalidir."
            );
          case "stockImpactMode must be NONE when chargeAllocationMethod != NONE":
            return l(
              "Charge lines cannot create stock movement directly.",
              "Masraf satirlari dogrudan stok hareketi olusturamaz."
            );
          case "chargeTargets must be a non-empty array when chargeAllocationMethod != NONE":
            return l(
              "Select at least one target line for the charge allocation.",
              "Masraf dagitimi icin en az bir hedef satir secin."
            );
          case "chargeTargets is allowed only when chargeAllocationMethod != NONE":
            return l(
              "Target lines can only be stored when charge allocation is enabled.",
              "Hedef satirlar yalnizca masraf dagitimi acikken tutulabilir."
            );
          case "chargeTargets manual allocation total must equal lineNetAmountTxn within tolerance 0.01":
            return l(
              "Manual charge split must match the line net amount.",
              "Manuel masraf dagitimi satirin net tutariyla eslesmelidir."
            );
          case "targetFixedAssetId must be empty for STOCK lines.":
            return l(
              "Stock lines cannot target a fixed asset.",
              "Stok satirlari bir duran varligi hedefleyemez."
            );
          case "targetFixedAssetId must be empty for NONE lines.":
            return l(
              "General lines cannot target a fixed asset.",
              "Genel satirlar bir duran varligi hedefleyemez."
            );
          case "Document cannot exceed 500 lines.":
            return l(
              "Document cannot exceed 500 lines.",
              "Belge 500 satiri asamaz."
            );
          default:
            break;
        }
        const stockLineWarehousePattern =
          /^lines\[\d+\]\.warehouseId is required for stock-affecting lines\.?$/;
        if (stockLineWarehousePattern.test(trimmedMessage)) {
          return l(
            "warehouseId is required for stock-affecting lines.",
            "Stok etkileyen satirlarda warehouseId zorunludur."
          );
        }
        const warehouseCodeReadOnlyPattern =
          /^lines\[\d+\]\.warehouseCode is read-only; send warehouseId only$/;
        if (warehouseCodeReadOnlyPattern.test(trimmedMessage)) {
          return l(
            "warehouseCode is read-only; send warehouseId only.",
            "warehouseCode salt okunurdur; yalnizca warehouseId gonderin."
          );
        }
        const warehouseNameReadOnlyPattern =
          /^lines\[\d+\]\.warehouseName is read-only; send warehouseId only$/;
        if (warehouseNameReadOnlyPattern.test(trimmedMessage)) {
          return l(
            "warehouseName is read-only; send warehouseId only.",
            "warehouseName salt okunurdur; yalnizca warehouseId gonderin."
          );
        }
        const warehouseLegalEntityPattern =
          /^lines\[\d+\]\.warehouseId must belong to legalEntityId$/;
        if (warehouseLegalEntityPattern.test(trimmedMessage)) {
          return l(
            "Selected warehouse must belong to the same legal entity.",
            "Secili depo ayni tuzel kisilige ait olmalidir."
          );
        }
        const activeWarehousePattern =
          /^lines\[\d+\]\.warehouseId must reference an ACTIVE warehouse$/;
        if (activeWarehousePattern.test(trimmedMessage)) {
          return l(
            "Selected warehouse must be active.",
            "Secili depo aktif olmalidir."
          );
        }
        const chargeTargetSameDocumentPattern =
          /^chargeTargets\[\d+\]\.targetLineNo must reference another line on the same document$/;
        if (chargeTargetSameDocumentPattern.test(coreMessage)) {
          return l(
            "Select another line on the same document as the charge target.",
            "Masraf hedefi olarak ayni belgedeki baska bir satiri secin."
          );
        }
        const chargeTargetDuplicatePattern =
          /^chargeTargets\[\d+\]\.targetLineNo duplicates another target$/;
        if (chargeTargetDuplicatePattern.test(coreMessage)) {
          return l(
            "The same target line cannot be selected twice.",
            "Ayni hedef satir iki kez secilemez."
          );
        }
        const chargeTargetSelfPattern =
          /^chargeTargets\[\d+\]\.targetLineNo cannot reference the same line$/;
        if (chargeTargetSelfPattern.test(coreMessage)) {
          return l(
            "A charge line cannot target itself.",
            "Masraf satiri kendisini hedefleyemez."
          );
        }
        const chargeTargetStandardPattern =
          /^chargeTargets\[\d+\]\.targetLineNo must reference a STANDARD line$/;
        if (chargeTargetStandardPattern.test(coreMessage)) {
          return l(
            "Charge targets must be STANDARD lines.",
            "Masraf hedefleri STANDARD satirlar olmalidir."
          );
        }
        const chargeTargetChargePattern =
          /^chargeTargets\[\d+\]\.targetLineNo cannot reference another charge line$/;
        if (chargeTargetChargePattern.test(coreMessage)) {
          return l(
            "Charge lines cannot target another charge line.",
            "Masraf satirlari baska bir masraf satirini hedefleyemez."
          );
        }
        const chargeTargetManualRequiredPattern =
          /^chargeTargets\[\d+\]\.allocatedAmountTxn is required$/;
        if (chargeTargetManualRequiredPattern.test(coreMessage)) {
          return l(
            "Enter a manual allocation amount for each selected target line.",
            "Secilen her hedef satir icin manuel dagitim tutari girin."
          );
        }
        const missingCategoryAccountPattern =
          /^lines\[\d+\]\.fixedAssetCategoryId is missing default_asset_account_id$/;
        if (missingCategoryAccountPattern.test(trimmedMessage)) {
          return l(
            "Selected asset category is missing its default asset account. Configure the category in Fixed Asset Settings and try again.",
            "Secili varlik kategorisinin varsayilan varlik hesabi eksik. Kategoriyi Demirbas Ayarlarinda yapilandirin ve tekrar deneyin."
          );
        }
        const missingCategoryProfilePattern =
          /^Category \(id=\d+\) must provide a default depreciation profile for FA06 capitalization$/;
        if (missingCategoryProfilePattern.test(trimmedMessage)) {
          return l(
            "Selected asset category is missing its default depreciation profile. Configure the category in Fixed Asset Settings and try again.",
            "Secili varlik kategorisinin varsayilan amortisman profili eksik. Kategoriyi Demirbas Ayarlarinda yapilandirin ve tekrar deneyin."
          );
        }
        const missingCategoryUsefulLifePattern =
          /^Category \(id=\d+\) must provide defaultUsefulLifeMonths for FA06 capitalization$/;
        if (missingCategoryUsefulLifePattern.test(trimmedMessage)) {
          return l(
            "Selected asset category is missing its default useful life. Configure the category in Fixed Asset Settings and try again.",
            "Secili varlik kategorisinin varsayilan faydali omru eksik. Kategoriyi Demirbas Ayarlarinda yapilandirin ve tekrar deneyin."
          );
        }
        const improvementMissingTargetPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId is required for IMPROVE_EXISTING posting$/;
        if (improvementMissingTargetPattern.test(trimmedMessage)) {
          return l(
            "Select the asset to improve before posting.",
            "Kayda almadan once iyilestirilecek varligi secin."
          );
        }
        const improvementMissingAssetPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId must reference an existing fixed asset$/;
        if (improvementMissingAssetPattern.test(trimmedMessage)) {
          return l(
            "Selected improvement asset no longer exists. Re-select the asset and try again.",
            "Secili iyilestirme varligi artik mevcut degil. Varligi yeniden secip tekrar deneyin."
          );
        }
        const improvementLegalEntityPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId must belong to legalEntityId$/;
        if (improvementLegalEntityPattern.test(trimmedMessage)) {
          return l(
            "Selected improvement asset must belong to the same legal entity.",
            "Secili iyilestirme varligi ayni tuzel kisilige ait olmalidir."
          );
        }
        const improvementStatusPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId must reference an ACTIVE, SUSPENDED, or FULLY_DEPRECIATED asset$/;
        if (improvementStatusPattern.test(trimmedMessage)) {
          return l(
            "Only ACTIVE, SUSPENDED, or FULLY_DEPRECIATED assets can be improved from this flow.",
            "Bu akista yalnizca ACTIVE, SUSPENDED veya FULLY_DEPRECIATED durumundaki varliklar iyilestirilebilir."
          );
        }
        const improvementNonDepreciablePattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId is only supported for depreciable assets$/;
        if (improvementNonDepreciablePattern.test(trimmedMessage)) {
          return l(
            "Only depreciable assets support improvement capitalization.",
            "Yalnizca amortismana tabi varliklar iyilestirme aktiflemesini destekler."
          );
        }
        const improvementLaterActivityPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId conflicts with later fixed-asset activity \(transactionId=(\d+), type=([A-Z_]+), effectiveDate=([0-9-]+)\)$/;
        const improvementLaterActivityMatch = trimmedMessage.match(
          improvementLaterActivityPattern
        );
        if (improvementLaterActivityMatch) {
          return l(
            `A later fixed-asset transaction already exists (transactionId=${improvementLaterActivityMatch[1]}, type=${improvementLaterActivityMatch[2]}, effectiveDate=${improvementLaterActivityMatch[3]}). Open the asset transactions, reverse or correct that later transaction first, then save or post this earlier improvement again.`,
            `Daha sonraki bir demirbas hareketi zaten mevcut (transactionId=${improvementLaterActivityMatch[1]}, type=${improvementLaterActivityMatch[2]}, effectiveDate=${improvementLaterActivityMatch[3]}). Demirbas hareketlerini acin, once sonraki hareketi tersleyin veya duzeltin, sonra bu daha erken iyilestirmeyi tekrar kaydedin ya da kayda alin.`
          );
        }
        const improvementSameDayLifeConflictPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId cannot apply another useful-life change on ([0-9-]+) because posted improvement transaction (\d+) already changes life on that date$/;
        const improvementSameDayLifeConflictMatch = trimmedMessage.match(
          improvementSameDayLifeConflictPattern
        );
        if (improvementSameDayLifeConflictMatch) {
          return l(
            `Another posted improvement on ${improvementSameDayLifeConflictMatch[1]} already changes useful life (transactionId=${improvementSameDayLifeConflictMatch[2]}). Only one life-changing improvement is allowed per asset on the same effective date. Reverse or revise the other same-day improvement first.`,
            `${improvementSameDayLifeConflictMatch[1]} tarihinde kayitli baska bir iyilestirme faydali omru zaten degistiriyor (transactionId=${improvementSameDayLifeConflictMatch[2]}). Ayni etkinlik tarihinde varlik basina yalnizca bir omur degistiren iyilestirmeye izin verilir. Once diger ayni gun iyilestirmesini tersleyin veya duzeltin.`
          );
        }
        const improvementDepreciationCurrentPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId requires depreciation to be current through ([0-9]{4}-[0-9]{2}) \(first missing period=([0-9]{4}-[0-9]{2})\)$/;
        const improvementDepreciationCurrentMatch = trimmedMessage.match(
          improvementDepreciationCurrentPattern
        );
        if (improvementDepreciationCurrentMatch) {
          return l(
            `Depreciation must be current through ${improvementDepreciationCurrentMatch[1]} before this improvement can be posted. First missing period: ${improvementDepreciationCurrentMatch[2]}.`,
            `Bu iyilestirme kayda alinmadan once amortisman ${improvementDepreciationCurrentMatch[1]} donemi sonuna kadar guncel olmalidir. Ilk eksik donem: ${improvementDepreciationCurrentMatch[2]}.`
          );
        }
        const improvementDraftRunPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId is blocked because the asset already appears in DRAFT depreciation run (\d+) \(([^)]+)\)$/;
        const improvementDraftRunMatch = trimmedMessage.match(improvementDraftRunPattern);
        if (improvementDraftRunMatch) {
          return l(
            `This asset already appears in draft depreciation run ${improvementDraftRunMatch[1]} (${improvementDraftRunMatch[2]}). Post or clear that run first.`,
            `Bu varlik zaten ${improvementDraftRunMatch[1]} numarali taslak amortisman run'inda yer aliyor (${improvementDraftRunMatch[2]}). Once o run'i kayda alin veya temizleyin.`
          );
        }
        const improvementFullyDepreciatedLifePattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId on a FULLY_DEPRECIATED asset requires revisedUsefulLifeMonths or lifeExtensionMonths$/;
        if (improvementFullyDepreciatedLifePattern.test(trimmedMessage)) {
          return l(
            "Fully depreciated assets require revised useful life or life extension before improvement posting.",
            "Tam amortismanli varliklarda iyilestirme kaydi icin revize faydali omur veya omur uzatimi gerekir."
          );
        }
        const improvementPositiveLifePattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId must result in positive remaining useful life$/;
        if (improvementPositiveLifePattern.test(trimmedMessage)) {
          return l(
            "The selected life change must leave the asset with positive remaining useful life.",
            "Secilen omur degisikligi varligi pozitif kalan faydali omurle birakmalidir."
          );
        }
        const improvementEffectiveAfterPostingPattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId effectiveDate \(([0-9-]+)\) cannot be after postingDate \(([0-9-]+)\)$/;
        const improvementEffectiveAfterPostingMatch = trimmedMessage.match(
          improvementEffectiveAfterPostingPattern
        );
        if (improvementEffectiveAfterPostingMatch) {
          return l(
            `Improvement effective date ${improvementEffectiveAfterPostingMatch[1]} cannot be later than the bill posting date ${improvementEffectiveAfterPostingMatch[2]}.`,
            `Iyilestirme etkinlik tarihi ${improvementEffectiveAfterPostingMatch[1]}, belge kayit tarihi ${improvementEffectiveAfterPostingMatch[2]}'den daha ileri olamaz.`
          );
        }
        const improvementBeforeInServicePattern =
          /^(?:storedLines|lines)\[\d+\]\.targetFixedAssetId effectiveDate \(([0-9-]+)\) cannot be before inServiceDate \(([0-9-]+)\)$/;
        const improvementBeforeInServiceMatch = trimmedMessage.match(
          improvementBeforeInServicePattern
        );
        if (improvementBeforeInServiceMatch) {
          return l(
            `Improvement effective date ${improvementBeforeInServiceMatch[1]} cannot be earlier than the asset in-service date ${improvementBeforeInServiceMatch[2]}.`,
            `Iyilestirme etkinlik tarihi ${improvementBeforeInServiceMatch[1]}, varligin hizmete alim tarihi ${improvementBeforeInServiceMatch[2]}'den daha erken olamaz.`
          );
        }
        if (
          /^Warehouse does not belong to ownership context /i.test(trimmedMessage)
        ) {
          return l(
            "Selected warehouse belongs to another ownership context.",
            "Secili depo baska bir sahiplik baglamina aittir."
          );
        }
        const dueDatePrefix = "dueDate is required for documentType=";
        if (trimmedMessage.startsWith(dueDatePrefix)) {
          const documentType = trimmedMessage
            .slice(dueDatePrefix.length)
            .replace(/\.$/, "");
          return l(
            `dueDate is required for documentType=${documentType}.`,
            `documentType=${documentType} icin dueDate zorunludur.`
          );
        }
        return trimmedMessage;
      }
    }
  }, [l]);
  const { legalEntities: workingContextLegalEntities } = useWorkingContext();
  const canRead = hasPermission("cari.doc.read");
  const canCreate = hasPermission("cari.doc.create");
  const canCancel = hasPermission("cari.doc.cancel");
  const canReadFixedAssets = hasPermission("fixed_assets.read");
  const canReadFixedAssetSettings = hasPermission("fixed_assets.settings.read");
  const canUpsertFixedAssetSettings = hasPermission("fixed_assets.settings.upsert");

  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [createBridgeVersion, setCreateBridgeVersion] = useState(0);
  const lastObservedUrlDocumentIdRef = useRef(null);
  const pendingUrlSelectionDocumentIdRef = useRef(null);
  const appliedCreatePrefillSignatureRef = useRef("");
  const createBridgeApiRef = useRef(null);
  const detailBridgeApiRef = useRef(null);
  const editBridgeApiRef = useRef(null);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [quickCreateFixedAssetOpen, setQuickCreateFixedAssetOpen] = useState(false);
  const [quickCreateFixedAssetForm, setQuickCreateFixedAssetForm] = useState(() =>
    createInitialQuickCreateFixedAssetForm()
  );
  const [quickCreateFixedAssetSaving, setQuickCreateFixedAssetSaving] = useState(false);
  const [quickCreateFixedAssetError, setQuickCreateFixedAssetError] = useState("");
  const [fixedAssetCategorySetupPrompt, setFixedAssetCategorySetupPrompt] = useState(null);
  const [inlineFixedAssetCategoryCreateContext, setInlineFixedAssetCategoryCreateContext] =
    useState(null);
  const [fixedAssetCategoryRefreshToken, setFixedAssetCategoryRefreshToken] =
    useState(0);

  const refreshFixedAssetCategoryLookups = useCallback(() => {
    setFixedAssetCategoryRefreshToken((current) => current + 1);
  }, []);
  const registerCreateBridgeApi = useCallback((api) => {
    createBridgeApiRef.current = api || null;
    setCreateBridgeVersion((current) => current + 1);
  }, []);
  const registerDetailBridgeApi = useCallback((api) => {
    detailBridgeApiRef.current = api || null;
  }, []);
  const registerEditBridgeApi = useCallback((api) => {
    editBridgeApiRef.current = api || null;
  }, []);
  const handleDetailStateChange = useCallback(
    ({ selectedDetail: nextDetail }) => {
      setSelectedDetail(nextDetail || null);
    },
    []
  );

  const requestListRefresh = useCallback(() => {
    setListRefreshToken((current) => current + 1);
  }, []);

  const requestDetailRefresh = useCallback(() => {
    setDetailRefreshToken((current) => current + 1);
  }, []);
  const handleEditDocumentUpdated = useCallback(
    ({ responseRow = null, refreshList = false, refreshDetail = false } = {}) => {
      detailBridgeApiRef.current?.applyMutationResultRow(responseRow || null);
      if (refreshList) {
        requestListRefresh();
      }
      if (refreshDetail) {
        requestDetailRefresh();
      }
    },
    [requestDetailRefresh, requestListRefresh]
  );
  const handleDocumentPosted = useCallback(
    ({ responseRow = null, refreshList = false, refreshDetail = false } = {}) => {
      detailBridgeApiRef.current?.applyMutationResultRow(responseRow || null);
      if (refreshList) {
        requestListRefresh();
      }
      if (refreshDetail) {
        requestDetailRefresh();
      }
    },
    [requestDetailRefresh, requestListRefresh]
  );
  const handleDocumentReversed = useCallback(
    ({
      originalRow = null,
      reversalRow = null,
      refreshList = false,
      refreshDetail = false,
    } = {}) => {
      void reversalRow;
      if (originalRow) {
        detailBridgeApiRef.current?.applyMutationResultRow(originalRow);
      }
      if (refreshList) {
        requestListRefresh();
      }
      if (refreshDetail) {
        requestDetailRefresh();
      }
    },
    [requestDetailRefresh, requestListRefresh]
  );
  const handleSelectDocument = useCallback((nextDocumentId, rowSnapshot = null) => {
    const normalizedDocumentId = toPositiveInt(nextDocumentId);
    setSelectedDocumentId(normalizedDocumentId || null);
    setSelectedRow(rowSnapshot || null);
  }, []);
  const selectedResolvedDetail = useMemo(
    () =>
      toPositiveInt(selectedDetail?.id) === toPositiveInt(selectedDocumentId)
        ? selectedDetail
        : null,
    [selectedDetail, selectedDocumentId]
  );
  const selectedSnapshot = selectedResolvedDetail || selectedRow;
  const canCancelSelected = Boolean(
    selectedSnapshot && isDraft(selectedSnapshot) && canCancel
  );
  const canCopySelectedToDraft = Boolean(selectedSnapshot && canCreate);

  const deepLinkedDocumentIdRaw = String(
    searchParams.get("documentId") || searchParams.get("document_id") || ""
  ).trim();
  const deepLinkedDocumentId = toPositiveInt(deepLinkedDocumentIdRaw);
  const fixedAssetSaleCreatePrefill = useMemo(
    () => buildFixedAssetSaleCreatePrefill(searchParams),
    [searchParams]
  );
  const fixedAssetSaleCreatePrefillSignature = useMemo(() => {
    if (!fixedAssetSaleCreatePrefill) {
      return "";
    }
    return [
      fixedAssetSaleCreatePrefill.mode,
      fixedAssetSaleCreatePrefill.direction,
      fixedAssetSaleCreatePrefill.targetFixedAssetId,
      fixedAssetSaleCreatePrefill.legalEntityId,
      fixedAssetSaleCreatePrefill.operatingUnitId,
      fixedAssetSaleCreatePrefill.assetNo,
      fixedAssetSaleCreatePrefill.assetName,
    ].join("|");
  }, [fixedAssetSaleCreatePrefill]);
  const documentPageTitle = getDocumentPageTitle(fixedRouteDirection, l);

  async function resolveDocumentCloneSourceRow(documentId, fallbackRow = null) {
    const normalizedDocumentId = toPositiveInt(documentId || fallbackRow?.id);
    if (!normalizedDocumentId) {
      return fallbackRow || null;
    }
    const loadedDetailId = toPositiveInt(selectedResolvedDetail?.id);
    if (
      loadedDetailId === normalizedDocumentId &&
      Array.isArray(selectedResolvedDetail?.lines) &&
      selectedResolvedDetail.lines.length > 0
    ) {
      return selectedResolvedDetail;
    }
    if (
      toPositiveInt(fallbackRow?.id) === normalizedDocumentId &&
      Array.isArray(fallbackRow?.lines) &&
      fallbackRow.lines.length > 0
    ) {
      return fallbackRow;
    }
    const response = await getCariDocument(normalizedDocumentId);
    return response?.row || fallbackRow || null;
  }

  async function resolvePreferredDocumentCloneSourceRow(documentId, fallbackRow = null) {
    const resolvedRow = await resolveDocumentCloneSourceRow(documentId, fallbackRow);
    const reversalOfDocumentId = toPositiveInt(
      resolvedRow?.reversalOfDocumentId ?? resolvedRow?.reversal_of_document_id
    );
    if (!reversalOfDocumentId) {
      return resolvedRow;
    }
    const originalRow = await resolveDocumentCloneSourceRow(
      reversalOfDocumentId,
      null
    );
    return originalRow || resolvedRow;
  }

  function requestCreatePrefill(sourceRow, options = {}) {
    const bridgeApi = createBridgeApiRef.current;
    if (!bridgeApi?.prefillCreateForm) {
      throw new Error(
        l(
          "Create draft area is not ready yet. Try again once the create section finishes loading.",
          "Taslak olusturma alani henuz hazir degil. Olusturma bolumu yuklenince tekrar deneyin."
        )
      );
    }
    bridgeApi.prefillCreateForm(sourceRow, options);
  }

  function openQuickCreateFixedAssetModal(context = {}) {
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm({
      ...createInitialQuickCreateFixedAssetForm(),
      ...context,
    });
    setQuickCreateFixedAssetOpen(true);
  }

  function openInlineFixedAssetCategoryCreate(context = {}) {
    setInlineFixedAssetCategoryCreateContext(context || null);
  }

  function requestFixedAssetCategorySetup(issue) {
    setFixedAssetCategorySetupPrompt(issue || null);
  }

  function handleInlineFixedAssetCategoryCreated(categoryRow) {
    const modalContext = inlineFixedAssetCategoryCreateContext || null;
    const scope = normalizeText(modalContext?.scope).toLowerCase();
    if (scope === "edit") {
      editBridgeApiRef.current?.applyInlineFixedAssetCategory?.(categoryRow, modalContext);
    } else if (scope === "create") {
      createBridgeApiRef.current?.applyInlineFixedAssetCategory?.(categoryRow, modalContext);
    }
    setInlineFixedAssetCategoryCreateContext(null);
    refreshFixedAssetCategoryLookups();
  }

  async function handleCopySelectedDocumentToCreateForm() {
    if (!selectedSnapshot) {
      createBridgeApiRef.current?.reportShellDraftTemplateFeedback?.({
        messageKind: "error",
        message: l(
          "Select a document first to copy into draft form.",
          "Taslak forma kopyalamak icin once bir belge secin."
        ),
      });
      return;
    }
    try {
      const sourceRow = await resolvePreferredDocumentCloneSourceRow(
        selectedDocumentId,
        selectedSnapshot
      );
      const copiedFromReversalRecord =
        toPositiveInt(
          selectedSnapshot?.reversalOfDocumentId ??
            selectedSnapshot?.reversal_of_document_id
        ) &&
        toPositiveInt(sourceRow?.id) !== toPositiveInt(selectedSnapshot?.id);
      requestCreatePrefill(sourceRow, {
        treatDueDateAsDerived: true,
        message: copiedFromReversalRecord
          ? l(
              `Draft copied from original document id=${sourceRow?.id || "-"} behind reversal record id=${selectedSnapshot?.id || "-"}.`,
              `Taslak, ters kayit belge id=${selectedSnapshot?.id || "-"} arkasindaki orijinal belge id=${sourceRow?.id || "-"} kaydindan kopyalandi.`
            )
          : l(
              `Draft form cloned from document id=${sourceRow?.id || "-"}`,
              `Taslak form belge id=${sourceRow?.id || "-"} kaydindan kopyalandi.`
            ),
      });
    } catch (error) {
      createBridgeApiRef.current?.reportShellDraftTemplateFeedback?.({
        message: normalizeApiError(
          error,
          l(
            "Failed to clone selected document into draft form.",
            "Secili belge taslak forma kopyalanamadi."
          )
        ),
        messageKind: "error",
      });
    }
  }

  function closeQuickCreateFixedAssetModal() {
    if (quickCreateFixedAssetSaving) {
      return;
    }
    setQuickCreateFixedAssetOpen(false);
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm(createInitialQuickCreateFixedAssetForm());
  }

  function patchQuickCreateFixedAssetForm(patch) {
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm((previous) => ({
      ...previous,
      ...patch,
    }));
  }

  async function handleQuickCreateFixedAssetSave() {
    const scope = normalizeText(quickCreateFixedAssetForm.scope).toLowerCase();
    const targetBridgeApi =
      scope === "edit" ? editBridgeApiRef.current : createBridgeApiRef.current;
    const lookupContext = targetBridgeApi?.getQuickCreateLookupContext?.() || null;
    const sourceForm = {
      legalEntityId: quickCreateFixedAssetForm.legalEntityId,
      documentDate: quickCreateFixedAssetForm.documentDate,
      currencyCode: quickCreateFixedAssetForm.currencyCode,
    };
    const sourceCategoryRows = Array.isArray(lookupContext?.categoryRows)
      ? lookupContext.categoryRows
      : [];
    const selectedCategory =
      sourceCategoryRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(quickCreateFixedAssetForm.categoryId)
      ) || null;
    const legalEntityId = toPositiveInt(sourceForm.legalEntityId);
    const categoryId = toPositiveInt(quickCreateFixedAssetForm.categoryId);
    const ownerOperatingUnitId = toPositiveInt(
      quickCreateFixedAssetForm.ownerOperatingUnitId
    );
    const locationOperatingUnitId = toPositiveInt(
      quickCreateFixedAssetForm.locationOperatingUnitId
    );
    const payload = {
      legalEntityId,
      name: normalizeText(quickCreateFixedAssetForm.name),
      categoryId,
      acquisitionDate: normalizeText(sourceForm.documentDate) || undefined,
      currencyCode: normalizeCurrencyCode(sourceForm.currencyCode) || undefined,
      originalCostTxn: 0,
      originalCostBase: 0,
      ownerOperatingUnitId: ownerOperatingUnitId || undefined,
      locationOperatingUnitId: locationOperatingUnitId || undefined,
      depreciationProfileId: toPositiveInt(
        selectedCategory?.defaultDepreciationProfileId ??
          selectedCategory?.default_depreciation_profile_id
      ) || undefined,
      usefulLifeMonths: toPositiveInt(
        selectedCategory?.defaultUsefulLifeMonths ??
          selectedCategory?.default_useful_life_months
      ) || undefined,
    };
    const salvageRuleType = normalizeText(
      selectedCategory?.defaultSalvageRuleType ??
        selectedCategory?.default_salvage_rule_type
    ).toUpperCase();
    if (payload.name.length === 0) {
      setQuickCreateFixedAssetError(
        l("Asset name is required.", "Varlik adi zorunludur.")
      );
      return;
    }
    if (!legalEntityId || !normalizeText(sourceForm.documentDate) || !payload.currencyCode) {
      setQuickCreateFixedAssetError(
        l(
          "Set legal entity, document date, and currency on the document first.",
          "Once belgede tuzel kisilik, belge tarihi ve para birimini doldurun."
        )
      );
      return;
    }
    if (!categoryId) {
      setQuickCreateFixedAssetError(
        l("Category is required.", "Kategori zorunludur.")
      );
      return;
    }
    if (!targetBridgeApi?.applyQuickCreatedFixedAsset) {
      setQuickCreateFixedAssetError(
        l(
          "The source document line is no longer available. Reopen quick-create from the active line.",
          "Kaynak belge satiri artik kullanilabilir degil. Hizli olusturmayi aktif satirdan yeniden acin."
        )
      );
      return;
    }
    const categorySetupIssue = getFixedAssetCategorySetupIssue(
      categoryId,
      buildRowsById(sourceCategoryRows)
    );
    if (categorySetupIssue) {
      const requirementList = formatFixedAssetCategorySetupRequirementList(
        categorySetupIssue.missingRequirements,
        l
      );
      setQuickCreateFixedAssetError(
        l(
          `Selected category "${categorySetupIssue.categoryLabel}" is missing required defaults: ${requirementList}. Configure it in Fixed Asset Settings first.`,
          `Secili "${categorySetupIssue.categoryLabel}" kategorisinde gerekli varsayilanlar eksik: ${requirementList}. Once Demirbas Ayarlarinda yapilandirin.`
        )
      );
      setFixedAssetCategorySetupPrompt(categorySetupIssue);
      return;
    }
    if (salvageRuleType && salvageRuleType !== "NONE") {
      payload.salvageRuleType = salvageRuleType;
      if (salvageRuleType === "PERCENT_OF_COST") {
        const salvagePercent = Number(
          selectedCategory?.defaultSalvagePercent ??
            selectedCategory?.default_salvage_percent ??
            0
        );
        if (Number.isFinite(salvagePercent)) {
          payload.salvagePercent = salvagePercent;
        }
      }
      if (salvageRuleType === "FIXED_BASE_AMOUNT") {
        const salvageAmountBase = Number(
          selectedCategory?.defaultSalvageAmountBase ??
            selectedCategory?.default_salvage_amount_base ??
            0
        );
        if (Number.isFinite(salvageAmountBase)) {
          payload.salvageAmountBaseRule = salvageAmountBase;
        }
      }
    }

    setQuickCreateFixedAssetSaving(true);
    setQuickCreateFixedAssetError("");
    try {
      const result = await createFixedAsset(payload);
      const createdAssetId = toPositiveInt(result?.id ?? result?.row?.id);
      if (!createdAssetId) {
        throw new Error(
          l("Asset creation did not return an id.", "Varlik olusturma bir kimlik donmedi.")
        );
      }
      const createdAssetRow = {
        ...(result?.row || result || {}),
        id: createdAssetId,
        status: "DRAFT",
        categoryId,
        categoryCode:
          selectedCategory?.code || selectedCategory?.categoryCode || selectedCategory?.category_code || null,
        categoryName:
          selectedCategory?.name || selectedCategory?.categoryName || selectedCategory?.category_name || null,
        ownerOperatingUnitId: ownerOperatingUnitId || null,
        locationOperatingUnitId: locationOperatingUnitId || null,
        legalEntityId,
        currencyCode: payload.currencyCode,
        assetNo: result?.assetNo || result?.row?.assetNo || result?.row?.asset_no || null,
        name: payload.name,
      };
      targetBridgeApi.applyQuickCreatedFixedAsset(
        createdAssetRow,
        quickCreateFixedAssetForm
      );
      setQuickCreateFixedAssetOpen(false);
      setQuickCreateFixedAssetForm(createInitialQuickCreateFixedAssetForm());
    } catch (error) {
      setQuickCreateFixedAssetError(
        normalizeApiError(
          error,
          l("Failed to create draft asset.", "Taslak varlik olusturulamadi.")
        )
      );
    } finally {
      setQuickCreateFixedAssetSaving(false);
    }
  }

  useEffect(() => {
    if (!deepLinkedDocumentIdRaw || deepLinkedDocumentId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("documentId");
    nextParams.delete("document_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedDocumentId,
    deepLinkedDocumentIdRaw,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    const previousDeepLinkedDocumentId = toPositiveInt(
      lastObservedUrlDocumentIdRef.current
    );
    const currentDeepLinkedDocumentId = toPositiveInt(deepLinkedDocumentId);
    const deepLinkChanged =
      Number(previousDeepLinkedDocumentId || 0) !==
      Number(currentDeepLinkedDocumentId || 0);
    lastObservedUrlDocumentIdRef.current = currentDeepLinkedDocumentId || null;
    if (!canRead || !currentDeepLinkedDocumentId) {
      pendingUrlSelectionDocumentIdRef.current = null;
      return;
    }
    if (!deepLinkChanged) {
      return;
    }
    if (Number(selectedDocumentId || 0) === Number(currentDeepLinkedDocumentId)) {
      pendingUrlSelectionDocumentIdRef.current = null;
      return;
    }
    pendingUrlSelectionDocumentIdRef.current = currentDeepLinkedDocumentId;
    setSelectedRow(null);
    setSelectedDocumentId(currentDeepLinkedDocumentId);
  }, [canRead, deepLinkedDocumentId, selectedDocumentId]);

  useEffect(() => {
    const selectedId = toPositiveInt(selectedDocumentId);
    const currentId = toPositiveInt(
      searchParams.get("documentId") || searchParams.get("document_id")
    );
    const pendingUrlSelectionId = toPositiveInt(
      pendingUrlSelectionDocumentIdRef.current
    );
    if (deepLinkedDocumentId && !selectedId) {
      return;
    }
    if (selectedId === currentId) {
      if (pendingUrlSelectionId && selectedId === pendingUrlSelectionId) {
        pendingUrlSelectionDocumentIdRef.current = null;
      }
      return;
    }
    if (pendingUrlSelectionId && currentId === pendingUrlSelectionId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    if (selectedId) {
      nextParams.set("documentId", String(selectedId));
    } else {
      nextParams.delete("documentId");
    }
    nextParams.delete("document_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedDocumentId,
    searchParams,
    selectedDocumentId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      !canCreate ||
      !fixedAssetSaleCreatePrefill ||
      !fixedAssetSaleCreatePrefillSignature
    ) {
      return;
    }
    const bridgeApi = createBridgeApiRef.current;
    if (!bridgeApi?.isReadyForShellPrefill?.()) {
      return;
    }
    if (
      appliedCreatePrefillSignatureRef.current ===
      fixedAssetSaleCreatePrefillSignature
    ) {
      return;
    }
    bridgeApi.applyPendingFixedAssetSalePrefill?.(fixedAssetSaleCreatePrefill);
    appliedCreatePrefillSignatureRef.current =
      fixedAssetSaleCreatePrefillSignature;
    setSearchParams(clearFixedAssetSaleCreatePrefill(searchParams), {
      replace: true,
    });
  }, [
    canCreate,
    createBridgeVersion,
    fixedAssetSaleCreatePrefill,
    fixedAssetSaleCreatePrefillSignature,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setSelectedRow(null);
      setSelectedDetail(null);
      return;
    }
  }, [selectedDocumentId]);

  async function handleCancelDraft() {
    if (!selectedDocumentId || !canCancelSelected) {
      setCancelError(
        l(
          "Only DRAFT documents can be cancelled with cari.doc.cancel permission.",
          "Yalnizca DRAFT belgeler `cari.doc.cancel` yetkisiyle iptal edilebilir."
        )
      );
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const response = await cancelCariDocument(selectedDocumentId);
      detailBridgeApiRef.current?.applyMutationResultRow(response?.row || null);
      requestListRefresh();
      requestDetailRefresh();
    } catch (error) {
      setCancelError(
        normalizeApiError(error, l("Failed to cancel draft document.", "Belge taslagi iptal edilemedi."))
      );
    } finally {
      setCancelSaving(false);
    }
  }

  async function handleCancelAndCopyDraft() {
    if (!selectedDocumentId || !canCancelSelected || !canCreate) {
      setCancelError(
        l(
          "Draft correction copy requires cari.doc.cancel and cari.doc.create permissions.",
          "Taslak duzeltme kopyasi icin `cari.doc.cancel` ve `cari.doc.create` yetkileri gerekir."
        )
      );
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const sourceRow = await resolveDocumentCloneSourceRow(
        selectedDocumentId,
        selectedSnapshot
      );
      const response = await cancelCariDocument(selectedDocumentId);
      detailBridgeApiRef.current?.applyMutationResultRow(response?.row || null);
      requestListRefresh();
      requestDetailRefresh();
      requestCreatePrefill(sourceRow, {
        preserveSourceDocumentDate: true,
        treatDueDateAsDerived: true,
        message: l(
          `Draft copied from cancelled document id=${sourceRow?.id || "-"}.`,
          `Taslak, iptal edilen belge id=${sourceRow?.id || "-"} kaydindan kopyalandi.`
        ),
      });
    } catch (error) {
      setCancelError(
        normalizeApiError(
          error,
          l(
            "Failed to cancel and copy draft document.",
            "Taslak iptal edilip kopyalanamadi."
          )
        )
      );
    } finally {
      setCancelSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: `cari.doc.read`
      </div>
    );
  }

  const quickCreateScope = normalizeText(quickCreateFixedAssetForm.scope).toLowerCase();
  const quickCreateLookupContext =
    (quickCreateScope === "edit"
      ? editBridgeApiRef.current?.getQuickCreateLookupContext?.()
      : createBridgeApiRef.current?.getQuickCreateLookupContext?.()) || null;
  const quickCreateCategoryOptions = quickCreateLookupContext?.categoryOptions || [];
  const quickCreateCategoriesById = quickCreateLookupContext?.categoriesById || new Map();
  const quickCreateOperatingUnitOptions =
    quickCreateLookupContext?.operatingUnitOptions || [];


  return (
    <div className="space-y-5">
      <section className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">
          {documentPageTitle}
        </h1>
      </section>

      <CariDocumentsCreateSection
        fixedDirection={fixedRouteDirection}
        fixedAssetCategoryRefreshToken={fixedAssetCategoryRefreshToken}
        canCopySelectedToDraft={canCopySelectedToDraft}
        onCopySelectedDocumentToCreateForm={handleCopySelectedDocumentToCreateForm}
        onDraftCreated={({ documentId, responseRow }) => {
          setSelectedRow(responseRow || null);
          if (documentId) {
            setSelectedDocumentId(documentId);
          }
          requestListRefresh();
        }}
        onOpenQuickCreateAsset={openQuickCreateFixedAssetModal}
        onOpenInlineFixedAssetCategoryCreate={openInlineFixedAssetCategoryCreate}
        onRequestFixedAssetCategorySetup={requestFixedAssetCategorySetup}
        registerCreateBridgeApi={registerCreateBridgeApi}
        translateDocumentMutationError={translateDocumentMutationError}
      />

      <CariDocumentsListSection
        fixedDirection={fixedRouteDirection}
        selectedDocumentId={selectedDocumentId}
        onSelectDocument={handleSelectDocument}
        listRefreshToken={listRefreshToken}
      />

      <CariDocumentsDetailSection
        selectedDocumentId={selectedDocumentId}
        detailRefreshToken={detailRefreshToken}
        selectedSnapshot={selectedSnapshot}
        canRead={canRead}
        canReadFixedAssets={canReadFixedAssets}
        workingContextLegalEntities={workingContextLegalEntities}
        fixedDirection={fixedRouteDirection}
        fixedAssetCategoryRefreshToken={fixedAssetCategoryRefreshToken}
        l={l}
        onDetailStateChange={handleDetailStateChange}
        registerDetailBridgeApi={registerDetailBridgeApi}
        onDocumentUpdated={handleEditDocumentUpdated}
        onDocumentPosted={handleDocumentPosted}
        onDocumentReversed={handleDocumentReversed}
        onCancelDraft={handleCancelDraft}
        onCancelAndCopyDraft={handleCancelAndCopyDraft}
        cancelSaving={cancelSaving}
        cancelError={cancelError}
        requestCreatePrefill={requestCreatePrefill}
        onOpenQuickCreateAsset={openQuickCreateFixedAssetModal}
        onOpenInlineFixedAssetCategoryCreate={openInlineFixedAssetCategoryCreate}
        onRequestFixedAssetCategorySetup={requestFixedAssetCategorySetup}
        registerEditBridgeApi={registerEditBridgeApi}
        translateDocumentMutationError={translateDocumentMutationError}
        canCopySelectedToDraft={canCopySelectedToDraft}
        onCopySelectedDocumentToCreateForm={handleCopySelectedDocumentToCreateForm}
      />

      <InlineFixedAssetCategoryCreateModal
        open={Boolean(inlineFixedAssetCategoryCreateContext)}
        legalEntityId={inlineFixedAssetCategoryCreateContext?.legalEntityId || ""}
        initialName={inlineFixedAssetCategoryCreateContext?.initialName || ""}
        l={l}
        onClose={() => setInlineFixedAssetCategoryCreateContext(null)}
        onCreated={handleInlineFixedAssetCategoryCreated}
      />
      <FixedAssetCategorySetupModal
        open={Boolean(fixedAssetCategorySetupPrompt)}
        l={l}
        categoryLabel={fixedAssetCategorySetupPrompt?.categoryLabel || ""}
        missingRequirements={fixedAssetCategorySetupPrompt?.missingRequirements || []}
        canReadSettings={canReadFixedAssetSettings}
        canUpsertSettings={canUpsertFixedAssetSettings}
        onClose={() => setFixedAssetCategorySetupPrompt(null)}
      />
      <FixedAssetQuickCreateModal
        open={quickCreateFixedAssetOpen}
        l={l}
        form={quickCreateFixedAssetForm}
        saving={quickCreateFixedAssetSaving}
        error={quickCreateFixedAssetError}
        legalEntityId={quickCreateFixedAssetForm.legalEntityId}
        acquisitionDate={quickCreateFixedAssetForm.documentDate}
        currencyCode={quickCreateFixedAssetForm.currencyCode}
        categoryOptions={quickCreateCategoryOptions}
        operatingUnitOptions={quickCreateOperatingUnitOptions}
        categoriesById={quickCreateCategoriesById}
        canReadSettings={canReadFixedAssetSettings}
        canUpsertSettings={canUpsertFixedAssetSettings}
        onChange={patchQuickCreateFixedAssetForm}
        onClose={closeQuickCreateFixedAssetModal}
        onSave={handleQuickCreateFixedAssetSave}
      />
    </div>
  );
}
