# Exact inherited endpoint access

2026-09-19 UTC, working changes atop `cf0ccb75935708a4794d40d26ccccaa9a46c0018`.
Compile-only native changes plus executed pure controls. No new native run.

The inheritance creator no longer uses DUPLICATE_SAME_ACCESS. Its fixed signed
route chooses an explicit mapped rights mask with DuplicateHandle options zero:

| End | Mask | Rights |
| --- | --- | --- |
| Reader (+1..+6) | 0x00120089 | READ_DATA, READ_EA, READ_ATTRIBUTES, READ_CONTROL, SYNCHRONIZE |
| Writer (-1..-6) | 0x00120082 | WRITE_DATA, READ_ATTRIBUTES, READ_CONTROL, SYNCHRONIZE |

No append/create-instance, WRITE_DAC, WRITE_OWNER, DELETE, generic access or
opposite-direction data right is requested. Unknown routes deny. The child local
checker now receives an expected signed route from its future trusted caller
and requires NtQueryObject's granted mask to equal the same fixed contract.
It does not merely check a subset, silently mask extra rights, or widen a failed
query. Actual Windows observations of these changed duplicates remain NOT RUN.

This connects creator and measurement policy, not complete child admission.
The existing pure child ordering policy and native checker still require a
trusted owner that binds exact endpoints to role/context and original clock.
The role cannot come from untrusted task input. Equal rights on unrelated pipes
do not prove the intended connection, peer or enrollment. No runtime caller,
new resume path, handle transport or authority token is introduced.

## Verification

Three create-only captures retain source/tool/output identities:

- `v3-metadata-host-child-policy-20260919-access`: 1,313 pure checks; all twelve
  signed routes, every single-bit mask change, opposite masks, zero/all bits and
  invalid routes, plus the prior ordering/deadline/failure controls.
- `v3-metadata-child-local-20260919-access`: four-source checker DLL compilation,
  warnings-as-errors; assembly NOT LOADED.
- `v3-metadata-host-suspended-20260919-access`: whole native stack, inert child
  and smoke fixture compilation only; 428 inheritance and 160 lifecycle pure
  checks pass. No native DLL load, smoke invocation or inert child execution.

The historical three approved native passes used the previous source hashes.
They are NOT evidence that this changed access contract works physically. The
old native runner's frozen source preflight must reject drift; do not replace its
pins to make a new binary appear covered by the earlier authorization. A future
bounded startup probe must identify these new inputs and obtain scoped approval.
No VM, service, provider, installer, real approval or W1-W5 acceptance occurred.
