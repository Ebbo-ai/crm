export function brokerSendBlocked(status: unknown, categories: string[]): boolean {
  return status !== "DIRECT" && status !== "BROKER" &&
    categories.some(c => ["RENEWAL_PROPOSAL", "PLAN_TRANSMITTAL", "INTERNAL_RENEWAL_REPORT"].includes(c));
}
