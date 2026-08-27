export interface SendResult {
  ok: boolean;
  /** The provider's own id for the message, kept so a delivery question can
   * be answered against their dashboard later. */
  providerRef?: string;
  error?: string;
}

export interface NotifyProvider {
  id: string;
  /** Every provider sends SMS to the number the buyer gave at checkout. The
   * field stays on the interface because the outbox records which channel a
   * message actually went out on, and "manual" is a real value there. */
  channel: "sms";
  /** False when the environment variables this provider needs are absent.
   * Same contract as the payment providers: an unconfigured provider is not
   * an error, it just means the manual path is used instead. */
  isConfigured(): boolean;
  send(toPhone: string, body: string): Promise<SendResult>;
}
