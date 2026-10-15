export type BrokerStatus = "DIRECT" | "BROKER" | "NOT_SET";
export function brokerStatusLabel(status: unknown): string {
  return status === "BROKER" ? "Broker" : status === "DIRECT" ? "Direct" : "Not set";
}
export function requireBrokerChoice(status: unknown): void {
  if (status !== "DIRECT" && status !== "BROKER") {
    throw Object.assign(new Error("Broker status is not set. Choose Direct or Broker before continuing."), { status: 400 });
  }
}
