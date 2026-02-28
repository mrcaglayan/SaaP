const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration071EvidenceStorageCompression = {
  key: "m071_evidence_storage_compression",
  description:
    "Evidence storage compression metadata (gzip/none codec + stored size bytes)",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE evidence_objects
         ADD COLUMN compression_codec ENUM('NONE','GZIP') NOT NULL DEFAULT 'NONE'
           AFTER content_type`
    );

    await safeExecute(
      connection,
      `ALTER TABLE evidence_objects
         ADD COLUMN stored_size_bytes BIGINT UNSIGNED NULL
           AFTER file_size_bytes`
    );

    await safeExecute(
      connection,
      `UPDATE evidence_objects
          SET stored_size_bytes = file_size_bytes
        WHERE stored_size_bytes IS NULL
          AND file_size_bytes IS NOT NULL`
    );
  },

  async down(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE evidence_objects
         DROP COLUMN stored_size_bytes`
    );
    await safeExecute(
      connection,
      `ALTER TABLE evidence_objects
         DROP COLUMN compression_codec`
    );
  },
};

export default migration071EvidenceStorageCompression;

