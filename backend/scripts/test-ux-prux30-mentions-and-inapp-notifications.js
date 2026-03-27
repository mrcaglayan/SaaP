import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCariDocumentsFeatureSource } from "./_cariDocumentsFeatureSource.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m074_mentions_and_in_app_notifications.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const commentsServiceSource = await readFile(
    path.resolve(root, "backend/src/services/internalComments.service.js"),
    "utf8"
  );
  const notificationsServiceSource = await readFile(
    path.resolve(root, "backend/src/services/me.notifications.service.js"),
    "utf8"
  );
  const meRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/me.js"),
    "utf8"
  );
  const cariDocumentCommentsRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.comments.routes.js"),
    "utf8"
  );
  const meApiSource = await readFile(
    path.resolve(root, "frontend/src/api/me.js"),
    "utf8"
  );
  const dashboardSource = await readFile(
    path.resolve(root, "frontend/src/pages/Dashboard.jsx"),
    "utf8"
  );
  const cariDocumentsApiSource = await readFile(
    path.resolve(root, "frontend/src/api/cariDocuments.js"),
    "utf8"
  );
  const cariDocumentsPageSource = await readCariDocumentsFeatureSource(root);

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS internal_comment_mentions") &&
      migrationSource.includes("CREATE TABLE IF NOT EXISTS in_app_notifications") &&
      migrationSource.includes("status ENUM('UNREAD','READ')"),
    "Migration m074 should create internal_comment_mentions and in_app_notifications tables"
  );
  assert(
    migrationIndexSource.includes(
      'import migration074MentionsAndInAppNotifications from "./m074_mentions_and_in_app_notifications.js"'
    ) && migrationIndexSource.includes("migration074MentionsAndInAppNotifications"),
    "Migration index should register m074_mentions_and_in_app_notifications"
  );

  assert(
    commentsServiceSource.includes("extractMentionEmailsFromBody") &&
      commentsServiceSource.includes("internal_comment_mentions") &&
      commentsServiceSource.includes("in_app_notifications") &&
      commentsServiceSource.includes("NOTIFICATION_TYPE_INTERNAL_COMMENT_MENTION"),
    "Internal comments service should parse mentions and create in-app notification rows"
  );

  assert(
    notificationsServiceSource.includes("listUserInAppNotifications") &&
      notificationsServiceSource.includes("markUserInAppNotificationReadById") &&
      notificationsServiceSource.includes("markAllUserInAppNotificationsRead"),
    "Notifications service should expose list/read/read-all helpers"
  );

  assert(
    meRouteSource.includes('router.get("/notifications"') &&
      meRouteSource.includes('router.put("/notifications/read-all"') &&
      meRouteSource.includes('router.put("/notifications/:notificationId/read"'),
    "me routes should expose notifications list/read/read-all endpoints"
  );

  assert(
    cariDocumentCommentsRouteSource.includes('"/mention-candidates"') &&
      cariDocumentCommentsRouteSource.includes("listCariDocumentMentionCandidates"),
    "cari document comments routes should expose mention-candidates lookup"
  );

  assert(
    meApiSource.includes("export async function listMeNotifications") &&
      meApiSource.includes("export async function markMeNotificationRead") &&
      meApiSource.includes("export async function markAllMeNotificationsRead"),
    "frontend me API should expose notifications list/read/read-all clients"
  );

  assert(
    dashboardSource.includes("Mentions & Notifications") &&
      dashboardSource.includes("listMeNotifications") &&
      dashboardSource.includes("markMeNotificationRead") &&
      dashboardSource.includes("markAllMeNotificationsRead"),
    "Dashboard should render in-app notifications section wired to me notification APIs"
  );

  assert(
    cariDocumentsApiSource.includes("export async function listCariDocumentMentionCandidates") &&
      cariDocumentsPageSource.includes("listCariDocumentMentionCandidates") &&
      cariDocumentsPageSource.includes("handleInternalCommentBodyKeyDown"),
    "Cari documents page should fetch mention candidates and support keyboard mention selection"
  );

  assert(
    cariDocumentsPageSource.includes("@email") &&
      cariDocumentsPageSource.includes("in-app notification"),
    "CariDocumentsPage internal comment form should hint mention format for notifications"
  );

  console.log(
    "PR-UX30 smoke test passed (mentions parsing + in-app notifications API/UI wiring)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
