const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration097ExceptionWorkbenchCashModule = {
  key: "m097_exception_workbench_cash_module",
  description: "Extend exception workbench module enum with CASH for FX ops exceptions",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE exception_workbench
         MODIFY COLUMN module_code ENUM('BANK','PAYROLL','CASH') NOT NULL`
    );
  },
};

export default migration097ExceptionWorkbenchCashModule;
