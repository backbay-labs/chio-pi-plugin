# Operator cancellation before result delivery

The existing response-loss qualification driver uses cancel-host-response.mjs
with CHIO_CANCEL_HOST_KIND=self. Its legacy case label remains host-response-loss;
the raw fault record identifies the actual SIGTERM cancellation cutpoint.
One actual native tool write commits. The operator launcher receives SIGTERM
before returning that completed result to the native host. The launcher exits
nonzero and reports unknown/unresolved, with no delivery acknowledgement.
An attempted replacement write remains fenced. Explicitly reading and
acknowledging the retained outcome permits one later read, without repeating
the write. Independent resource and dispatch observations remain in each stage.
This tests one cancellation cutpoint, not all lifecycle acceptance requirements.
