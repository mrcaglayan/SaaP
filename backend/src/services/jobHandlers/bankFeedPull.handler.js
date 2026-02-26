function notImplementedError(message) {
  const err = new Error(message);
  err.status = 501;
  err.errorCode = "JOB_HANDLER_NOT_IMPLEMENTED";
  err.retryable = false;
  return err;
}

const bankFeedPullHandler = {
  async run({ payload }) {
    throw notImplementedError(
      `BANK_FEED_PULL handler is not wired yet for this repo (provider_connection_id=${payload?.provider_connection_id ?? "?"})`
    );
  },
};

export default bankFeedPullHandler;
