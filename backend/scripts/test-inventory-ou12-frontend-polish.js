import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadRepoFile(root, relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const [
    transferServiceSource,
    inventoryServiceSource,
    appSource,
    sidebarSource,
    messagesSource,
    transferPageSource,
    movementsPageSource,
    itemCardsPageSource,
    cariSettlementsApiSource,
    settlementsPageSource,
  ] = await Promise.all([
    loadRepoFile(root, "backend/src/services/inventory.transfer.service.js"),
    loadRepoFile(root, "backend/src/services/inventory.service.js"),
    loadRepoFile(root, "frontend/src/App.jsx"),
    loadRepoFile(root, "frontend/src/layouts/sidebarConfig.js"),
    loadRepoFile(root, "frontend/src/i18n/messages.js"),
    loadRepoFile(root, "frontend/src/pages/inventory/InventoryTransfersPage.jsx"),
    loadRepoFile(root, "frontend/src/pages/inventory/InventoryMovementsPage.jsx"),
    loadRepoFile(root, "frontend/src/pages/inventory/ItemCardsPage.jsx"),
    loadRepoFile(root, "frontend/src/api/cariSettlements.js"),
    loadRepoFile(root, "frontend/src/pages/cari/CariSettlementsPage.jsx"),
  ]);

  assert(
    transferServiceSource.includes("shipment_journal_no") &&
      transferServiceSource.includes("receipt_journal_no") &&
      transferServiceSource.includes("reversal_journal_no"),
    "Inventory transfer service should expose shipment/receipt/reversal journal numbers"
  );

  assert(
    inventoryServiceSource.includes("source_transfer_no") &&
      inventoryServiceSource.includes("source_transfer_status") &&
      inventoryServiceSource.includes("source_document_type = 'INVENTORY_TRANSFER'"),
    "Inventory service should expose transfer source reference fields for movement visibility"
  );

  assert(
    appSource.includes('appPath: "/app/stok-transferleri"') &&
      appSource.includes('childPath: "stok-transferleri"'),
    "App route wiring should keep the canonical transfer route"
  );

  assert(
    sidebarSource.includes('label: "Stok Transferleri"') &&
      sidebarSource.includes('to: "/app/stok-transferleri"') &&
      sidebarSource.includes('requiredPermissions: ["inventory.read"]') &&
      sidebarSource.includes("implemented: true"),
    "Sidebar should keep the implemented inventory transfer entry on inventory.read permission"
  );

  assert(
    messagesSource.includes('"/app/stok-transferleri": "Stok Transferleri"') &&
      messagesSource.includes('"/app/stok-transferleri": "Inventory Transfers"'),
    "Sidebar i18n should expose TR/EN labels for the transfer route"
  );

  assert(
    transferPageSource.includes('sourceWarehouseId: ""') &&
      transferPageSource.includes('targetWarehouseId: ""') &&
      transferPageSource.includes("Transfer lifecycle") &&
      transferPageSource.includes("Transfer journals") &&
      transferPageSource.includes("Shipment journal") &&
      transferPageSource.includes("Receipt journal") &&
      transferPageSource.includes("Reversal journal") &&
      transferPageSource.includes("Evidence attachments") &&
      transferPageSource.includes("Available actions") &&
      transferPageSource.includes("Only actions valid for the current lifecycle are enabled.") &&
      transferPageSource.includes('sourceWarehouseId: filters.sourceWarehouseId || undefined') &&
      transferPageSource.includes('targetWarehouseId: filters.targetWarehouseId || undefined') &&
      transferPageSource.includes("listItemCards({") &&
      transferPageSource.includes("operatingUnitId: operatingUnitId || undefined"),
    "Transfer page should expose finalized filters, lifecycle, journals, evidence, and action gating"
  );

  assert(
    movementsPageSource.includes("function describeMovementSource") &&
      movementsPageSource.includes('translate("Inventory transfer", "Stok transferi")') &&
      movementsPageSource.includes('translate("Stock link", "Stok baglantisi")') &&
      movementsPageSource.includes('translate("Manual entry", "Manuel giris")'),
    "Movement page should distinguish transfer, stock-link, and manual sources"
  );

  assert(
    itemCardsPageSource.includes("function describeTransitSetup") &&
      itemCardsPageSource.includes("Transit setup") &&
      itemCardsPageSource.includes(
        "Cross-context stock transfers should have a transit account before shipment starts."
      ) &&
      itemCardsPageSource.includes(
        "Stock transfer shipment and receipt postings can reuse this transit account."
      ),
    "Item cards page should expose transfer transit setup guidance and visibility"
  );

  assert(
    settlementsPageSource.includes("Collector context preview:") &&
      settlementsPageSource.includes(
        "Owner = open-item/document context. Collector = cash, bank, or execution context that closes it."
      ),
    "Settlement page should explain owner vs collector context in the apply preview"
  );

  assert(
    cariSettlementsApiSource.includes("getCariSettlementErrorHint") &&
      cariSettlementsApiSource.includes(
        "Selected items span multiple owner contexts. Split the settlement by owner OU."
      ) &&
      cariSettlementsApiSource.includes(
        "Complete both directional partner-OU current-account mappings before retrying."
      ),
    "Settlement API helper should keep the operator-facing cross-context warning and error hints"
  );

  console.log("PR-OU12 frontend polish smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
