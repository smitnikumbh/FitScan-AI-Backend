// Retries a Gemini generateContent call on transient overload (503) only.
// 429 (quota exceeded) is NOT retried — daily/per-minute quota errors don't resolve
// in seconds, and retrying just burns through an already-exhausted allowance faster.
async function generateWithRetry(model, input, { retries = 2, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(input);
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const isTransientOverload = status === 503 || /503|overloaded|high demand/i.test(err.message || "");
      if (!isTransientOverload || attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

module.exports = { generateWithRetry };
