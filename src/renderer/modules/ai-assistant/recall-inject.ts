/**
 * Pure helper for the "Recall into chat" bridge: Mind's Eye dispatches a
 * `dcs98:minds-eye-recall` window event carrying a node's label, and the AI Assistant composer
 * appends it to whatever the user is currently drafting. Kept pure + separate so the append
 * semantics are unit-testable without a DOM — see test/ai-recall-inject.test.ts.
 */

/** Append `text` to the current composer draft, separating with a newline when the draft is
 *  non-empty. Trims surrounding whitespace so an empty/whitespace-only draft yields just the
 *  recalled text and a blank recall is a no-op. */
export function appendRecalled(current: string, text: string): string {
  const add = text.trim();
  const cur = current.trim();
  if (!add) return cur;
  return cur ? `${cur}\n${add}` : add;
}
