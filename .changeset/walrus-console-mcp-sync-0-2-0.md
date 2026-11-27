---
'@mysten-incubation/walrus-console-mcp': minor
---

Sync with upstream walrus-console-mcp.

Behavior changes:

- `install --silent` now needs `--register` or `--no-register`. Without one of them it exits 1
  instead of finishing without registering the server with any agent.
- The path sandbox refuses your Home directory as an allowed root. `download_file` refuses to
  write dotfiles and files named like credentials. `delete_bucket`, `delete_file` and an
  overwriting `download_file` now also ask the human for approval through MCP elicitation when
  the client supports it.
- Credential environment variables override the saved config one value at a time. Each nonblank
  variable replaces only its matching saved field, and an empty or unset one falls back to the
  saved value.
- Tool errors no longer include the JavaScript stack trace. Set `CONSOLE_MCP_DEBUG=1` to get it
  back.
- `ping_console` now calls Console. `ok` means Console accepted the API key, not only that a key
  is configured.
- When an agent starts the server, it checks in with Console once at startup.

Other changes:

- `upload_file` returns the name the file was stored under.
- Saved allowed folders take an explicit `allowedDirsScope` (`shared` or fallback), so a saved
  list can join the agent's workspace folders instead of only standing in for them.
- `create_bucket` keeps and reports the bucket id when the finalize step fails.
- Local-agent hardening: Console error bodies that don't parse are no longer echoed into tool
  results, ids are encoded before they reach a Console URL, `update_file` and
  `update_bucket_metadata` are marked destructive, and masked prompts no longer reveal the
  secret's length.
- Registered agent entries carry an install-target label, and requests send runtime attribution
  headers.
- The create-bucket fixture script sends `members`; omitting it is deprecated by Console.
- Test fixes after `ping_console` started calling Console.
