/** The speaker a conversation message is attributed to. */
export type Role = "system" | "user" | "assistant" | "tool";

const ROLES: readonly Role[] = ["system", "user", "assistant", "tool"];

/** Returns whether `value` is a valid {@link Role}. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** A single message in a conversation's history. */
export interface Message {
  /** Who this message is attributed to. */
  readonly role: Role;
  /** The textual content of the message. */
  readonly content: string;
}
