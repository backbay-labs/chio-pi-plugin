# Concurrent launchers retaining the same authority

The actual native host emitted a protected write. The trusted test transport
paused that exact call before kernel dispatch, with its gateway lock and pending
journal intact. A second launcher using the original authority refused startup.
It emitted no native tool calls and caused no resource dispatch or journal lock
change. This second refusal is explicitly a preflight case.

Releasing the original native call completed one write. A later native session
using the original authority read the result once. Independent resource/audit
observations retain all attempts and show zero competing writes. This qualifies
exclusive ownership under concurrent launchers, not every parallel-call schedule
within a single native host. The runtime artifacts are unchanged.
