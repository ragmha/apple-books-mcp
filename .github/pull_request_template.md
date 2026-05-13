## Summary

<!-- What changed and why? -->

## Safety

<!-- If this touches writes, explain the snapshot/transaction/error behavior. -->

- [ ] No direct writes outside a mutation seam.
- [ ] User input is parameterized or validated.
- [ ] MCP-facing errors do not expose private book/note/highlight content.

## Validation

- [ ] `bun run check`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] README/CONTEXT updated if the public tool surface or architecture changed.
