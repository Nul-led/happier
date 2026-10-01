# 0.2 data-continuity fixture

`home-and-client.tar.gz` contains synthetic data written by the read-only `../0.2`
checkout on 2026-09-28. The original data-key and legacy-secret Accounts were
produced at `ff95c165f6d4be5efa220d050f03d54e826d1526`; a third
legacy-secret Account was added through the 0.2 server and CLI at
`bfdfd78b5bdc6bc1f8eec704728e898463ccd585` against an isolated copy of
the archive. A 0.2 light server using its SQLite migrations created three E2EE
Accounts; the normal data-key Account has one Machine, three Sessions,
three encrypted messages, and version 1 encrypted Account settings. Its 0.2 CLI
home also has a saved `cloud` profile, a local preference, and the Account-scoped
Machine ID mapping. The second Account
uses the older legacy-secret credential shape and is retained to expose its
separate migration-required path. The third Account has a saved 0.2
`{ token, secret }` credential, one Machine, one Session and one legacy-encrypted
message that the 0.2 CLI decrypted before upgrade.

The archive contains only the isolated server SQLite database and its generated
master secret, plus the synthetic data-key client's `settings.json` and
`servers/cloud/access.key`, and the third Account's
`client-02-legacy/servers/cloud/access.key`. The tokens and keys in this fixture
authenticate only against this generated database. SHA-256 of the archive is
`287001864115c82c8dd3ba6caaf3ba722d23390db31ceaa666b7f9b8403a1d4c`.
The local Home URL is a test transport stand-in
for a Cloud-named profile; this fixture does not represent a hosted Cloud
deployment or verify the desktop UI's keep choice.

Regenerate from the pinned predecessor producer and re-run the continuity test
before replacing the archive; current-version serializers are not fixture
producers. Released 0.2 migration SQL is immutable.
