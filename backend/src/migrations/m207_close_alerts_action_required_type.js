/**
 * m207 - Action-required close alert type.
 *
 * Extends the durable close-alert read model so readiness prompts can be stored
 * distinctly from due, blocked, and stale operational alerts.
 */

async function getAlertTypeColumnType(connection) {
  const [rows] = await connection.execute(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'close_alerts'
        AND column_name = 'alert_type'
      LIMIT 1`,
  );
  return String(rows?.[0]?.column_type || "");
}

const migration207CloseAlertsActionRequiredType = {
  key: "m207_close_alerts_action_required_type",
  description: "Allow ACTION_REQUIRED close alerts for ready-to-start consolidation prompts.",
  async up(connection) {
    const currentColumnType = await getAlertTypeColumnType(connection);
    if (currentColumnType.toUpperCase().includes("'ACTION_REQUIRED'")) {
      return;
    }
    await connection.execute(
      `ALTER TABLE close_alerts
         MODIFY COLUMN alert_type ENUM(
           'DUE_SOON',
           'OVERDUE',
           'BLOCKED',
           'STALE',
           'ACTION_REQUIRED'
         ) NOT NULL`,
    );
  },

  async down() {
    // Additive enum expansion only.
  },
};

export default migration207CloseAlertsActionRequiredType;
