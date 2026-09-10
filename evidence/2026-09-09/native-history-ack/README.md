# Native history acknowledgement

Status: unaccepted. The previous guest-acknowledgement confirmation loss caused
actual uncertainty followed by redispatch. This candidate returns the complete
verified result to the native host first. The trusted model relay observes it
in inline tool history, verifies it against the private original request, and
acknowledges before forwarding the next model turn. The guest no longer sends
a separate acknowledgement RPC. One tool per model turn is enforced in the
provider request; overlapping protected operations remain fenced.

The same real host and acknowledgement-loss injector now complete the original
write, with no guest acknowledgement-response cutpoint and exactly one observed
resource write. The owning launcher journal confirms that native history
delivery was acknowledged. The old injector has a retained failing predecessor
control; an empty fault file is expected because that guest route is removed.

The installed candidate separately passed useful write/edit/read/list, forbidden
read/write, final result loss with same-authority recovery, and result-byte
substitution. All five have independent resource observations. Eighteen component
tests passed with no skips. These cases do not close I01-I08; process boundaries,
complete authority and approval behavior, cancellation and later crash points,
installation lifecycle and publication remain required.
