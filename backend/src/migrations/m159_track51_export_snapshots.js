/**
 * m159 - Track 51 persisted export snapshots.
 *
 * Extends the shared immutable export-snapshot retention seam so the RP13
 * consolidation member-support evidence flow can persist reproducible server-
 * side artifacts without introducing a second retention subsystem.
 */

async function periodExportSnapshotsTableExists(connection) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'period_export_snapshots'
     LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration159Track51ExportSnapshots = {
  key: "m159_track51_export_snapshots",
  description:
    "Extend immutable export snapshots for Track 51 consolidated member-support audit evidence.",
  async up(connection) {
    if (!(await periodExportSnapshotsTableExists(connection))) {
      return;
    }

    await connection.execute(
      `ALTER TABLE period_export_snapshots
       MODIFY COLUMN snapshot_type
         ENUM('PAYROLL_CLOSE_PERIOD','TRACK51_CONSOLIDATED_MEMBER_SUPPORT')
         NOT NULL DEFAULT 'PAYROLL_CLOSE_PERIOD'`,
    );
  },
};

export default migration159Track51ExportSnapshots;
