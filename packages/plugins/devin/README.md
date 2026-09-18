# Devin plugin

First-party Happier integration for the user-installed Devin CLI through its
ACP stdio server (`devin acp`). The host owns session and execution-run
composition; this plugin owns Devin-specific executable, authentication,
permission-mode, model-option, resume, native MCP configuration, and UI facts.

The installed Devin CLI does not consume the standard ACP `mcpServers` launch
field. For each session or execution run, the plugin therefore merges the
host-selected MCP servers with the user's native Devin MCP configuration in a
protected temporary platform config root (`XDG_CONFIG_HOME` on macOS/Linux and
`APPDATA` on Windows). Other Devin and Cognition config entries are projected
through symlinks or Windows directory junctions; launch fails if those links
cannot be created, so provider-owned mutable state is never copied into a
second authority. Only the merged MCP file is session-private. The
user's MCP files are never modified, and the temporary root is removed when the
provider session closes.
Native project and project-local servers remain available. A same-named
project server has higher Devin precedence, so the plugin rejects that
collision before launch rather than allowing it to shadow a session-selected
server such as Happier's built-in tool bridge.
