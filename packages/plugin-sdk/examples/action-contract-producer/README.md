# Advanced Public Cross-plugin Contribution Target

This copyable plugin owns the `document-reviewers` contribution point. It
imports the canonical versioned `@happier-dev/triage-protocol`, which declares
the source descriptor, required source Action roles, and required detail surface.
The paired contributor imports that same feature-owned value. Neither plugin
recreates the protocol or imports the other plugin's implementation. The target
has no contributor registry, runtime callback, or Action lookup. Its
`list-document-reviewers` Action demonstrates the live target side: it reserves
an `observeForSelf(...)` observation from its generated typed point, reads the
complete admitted snapshot, and disposes the observation in `finally`.

This pair is an advanced public Developer Preview reference because the Triage
contract includes descriptor and embedded-surface roles. External and bundled
plugins use the same public contracts and physical host. The generated
`capability-matrix.json` remains the availability authority; the example does
not create a separate support tier or claim loaded-platform or publication
proof.

It also shows the public browser and request-policy declarations: a browser
target, a browser Action bound to this plugin's canonical Action, and a
`requestInterceptors` declaration scoped to the document-review API origin.
Request interception is trusted installation-wide policy and is reviewed from
its declared origins and methods; it does not require a `network.intercept`
HostAccess declaration.
The handler returns the request unchanged; the host remains the only fetch and
policy-chain owner, and plugins cannot use this path to rewrite bodies or inject
provider authentication.

The example also declares a normal command and agent/MCP tool that both invoke
one Action. That Action sends a `document-review-ready` notification through
the public Notifications service. Its `webhook` channel is registered during
activation and declares an Account-scoped webhook URL that the existing Plugin
Settings screen renders and saves; there is no separate notification-settings
screen or second configuration store.

The webhook credential itself is a declared plugin secret. A second Action
rotates it through the public Secrets service: it reads `status` for the
incumbent revision, passes that revision as `expectedRevision` so a concurrent
rotation loses instead of overwriting, reads the value back at the point of use
with a user-readable reason, and returns only the state and revision. The value
is never written to settings, plugin storage, an Action result, or a log line.

`inspect-team-credential-parity` is the installed-external-style Lane 10
consumer. It discovers Team credential resources and source candidates, reads
the material-safe direct-preparation census, and lists shared Saved Secrets
through the same canonical host Actions used by bundled callers. It also uses
the public Provider and Connected Account services and contribution identities;
there is no host import, private first-party route, or duplicate catalog.
`update-shared-secret` demonstrates a content-bearing Saved Secret mutation:
the host may return an `approval_request_created` result unchanged, and domain
failures retain their typed `PluginError` code/details. The replacement value is never
returned. Raw material resolution remains with the host-owned materializer and
is intentionally not exposed as a generic public Action.

The paired contributor is `../action-contract-consumer`.

Build, test, and load this plugin through the normal managed source-author
commands:

```sh
hdev plugins dev build .
hdev plugins test .
hdev plugins dev
```
