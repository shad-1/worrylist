import { GUARDRAILS } from "../config/guardrails";

export interface GuardrailResult {
  passed: boolean;
  reason?: string;
  sanitized?: string;
}

export function validateInput(content: string): GuardrailResult {
  if (content.length > GUARDRAILS.input.max_content_length) {
    return { passed: false, reason: `Content exceeds max length of ${GUARDRAILS.input.max_content_length}` };
  }

  for (const pattern of GUARDRAILS.input.blocked_patterns) {
    if (pattern.test(content)) {
      return { passed: false, reason: `Prompt injection pattern detected: ${pattern.source}` };
    }
  }

  return { passed: true, sanitized: content.trim() };
}
