# Walrus Console MCP file access

**Harness**: The application that spawns the MCP server and hosts the agent. User-facing copy calls it the MCP client.

**Agent**: The model working inside a harness session.

**Workspace folders**: The folders the harness reports as open in the current session. They can change as the user opens or adds folders.

**Saved folders**: The folders the user chose for file access during setup. They are kept on the machine with one scope for the complete list.

**Fallback scope**: Saved folders grant access only when no workspace or environment folders are provided. Missing or invalid scope retains this behavior.

**Shared scope**: The user explicitly grants the saved folders to every session using this configuration, including unrelated projects, subject to the security exceptions. Shared grants do not provide project isolation.

**Allowed folders**: The folders upload and download may use right now. A path outside them is refused.

**Broad Home folder**: The user's home directory or an ancestor containing it.

These are domain terms. The combination rules and security exceptions are described in the [README Security Model](README.md#security-model).
