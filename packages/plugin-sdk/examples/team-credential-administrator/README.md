# Team credential administrator

This installable external-style package demonstrates Lane 10 parity through the public `@happier-dev/plugin-sdk` `activate(api)` ABI. Its manifest-declared `inspect` Action uses the host `ActionsService` to reach the same Team credential catalog, entitled-resource catalog, production test, usage query, optional resource update, and shared Saved Secret catalog available to maintained built-ins.

The example deliberately has no credential material, broker, readiness, source/recipient identity, Team/Session principal, or Account-authority API. The host stamps the authenticated plugin caller, applies the canonical feature and resource authorization decisions, checks Team/Session authority and current revisions, and owns configurable approval. Inputs such as `teamId`, `resourceId`, and `expectedRevision` are selectors and preconditions, never authority claims. Results contain counts and safe status only.

Build and test it through the normal authoring commands:

```sh
hdev plugins dev typecheck .
hdev plugins test .
hdev plugins dev build .
```

For loaded proof, install the built package into a current-source daemon whose Home has `teams.credentialResources` enabled, activate `examples.team-credential-administrator`, and invoke `inspect` as an Account that can access the selected Team/resource. A broker Machine and usable source are required for the production `teams.credentials.test` result; they are not required for package installation or activation.
