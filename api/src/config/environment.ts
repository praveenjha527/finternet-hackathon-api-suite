/**
 * Minimal env validation (kept permissive for hackathon/dev).
 * Missing chain/contract env vars will cause on-chain operations to fall back to mock mode.
 */
export function environmentSchema(env: Record<string, unknown>) {
  const PORT = typeof env.PORT === "string" ? env.PORT : undefined;
  if (PORT && Number.isNaN(Number(PORT))) {
    throw new Error("Invalid env var PORT: must be a number-like string");
  }

  const OFF_RAMP_MOCK_DELAY =
    typeof env.OFF_RAMP_MOCK_DELAY === "string"
      ? env.OFF_RAMP_MOCK_DELAY
      : undefined;
  if (OFF_RAMP_MOCK_DELAY && Number.isNaN(Number(OFF_RAMP_MOCK_DELAY))) {
    throw new Error(
      "Invalid env var OFF_RAMP_MOCK_DELAY: must be a number-like string",
    );
  }

  // Redis URL for BullMQ (optional, defaults to localhost)
  const REDIS_URL =
    typeof env.REDIS_URL === "string" ? env.REDIS_URL : undefined;
  // Validation is permissive - can be undefined for default localhost

  return env;
}
