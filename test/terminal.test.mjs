import assert from "node:assert/strict";
import test from "node:test";
import { terminalState } from "../dist/terminal.js";

test("only a normal provider stop can report conversation completion", () => {
  for (const reason of ["length", "toolUse", undefined, "future-unknown-reason"]) {
    const result = terminalState({ providerStopReason: reason, unresolved: false, toolErrors: 0 });
    assert.notEqual(result.exitCode, 0, String(reason));
    assert.equal(result.outcome, "incomplete");
  }
  assert.deepEqual(terminalState({ providerStopReason: "stop", unresolved: false, toolErrors: 1 }), { outcome: "completed_with_tool_errors", exitCode: 0 });
});

test("resource uncertainty survives provider completion, failure and cancellation", () => {
  for (const providerStopReason of ["stop", "error", "aborted", "length"]) {
    assert.deepEqual(terminalState({ unresolved: true, providerStopReason, termination: "SIGINT", toolErrors: 1 }), { outcome: "unresolved", exitCode: 2 });
  }
  assert.deepEqual(terminalState({ unresolved: false, providerStopReason: "aborted", termination: "SIGTERM", toolErrors: 0 }), { outcome: "cancelled", exitCode: 143 });
  assert.deepEqual(terminalState({ unresolved: false, providerStopReason: "error", toolErrors: 0 }), { outcome: "failed", exitCode: 1 });
});
