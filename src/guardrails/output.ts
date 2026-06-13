import { GUARDRAILS } from "../config/guardrails";
import type { GuardrailResult } from "./input";

export function validateOutput(text: string): GuardrailResult {
  if (text.length > GUARDRAILS.output.max_length) {
    return { passed: false, reason: `Output exceeds max length of ${GUARDRAILS.output.max_length}` };
  }
  return { passed: true };
}
