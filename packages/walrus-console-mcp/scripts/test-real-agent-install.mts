/** Opt-in smoke test against installed client binaries, always in a temporary profile. */
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installProfile, repository } from "../tests/helpers/installProfile.js";

const keep = process.argv.includes("--keep");
const profile = installProfile();
function client(bin: string, args: string[]) {
  const result = spawnSync(bin, args, {
    env: profile.env,
    encoding: "utf8",
    timeout: 60_000,
    shell: process.platform === "win32",
  });
  assert.equal(
    result.status,
    0,
    `${bin} ${args.join(" ")}: ${result.error?.message ?? result.stderr}`,
  );
  return result.stdout;
}
try {
  fs.mkdirSync(profile.env["CODEX_HOME"]!, { recursive: true });
  // These are the installed clients, not recorder executables.
  for (const bin of ["claude", "codex", "cursor"]) {
    const version = client(bin, ["--version"]).trim();
    console.log(`${bin}: ${version.split("\n")[0]}`);
  }
  // Let real agy initialize/migrate its scratch profile before registration.
  client("agy", ["mcp", "list"]);
  if (!fs.existsSync(path.join(profile.root, ".gemini", "config", ".migrated"))) {
    // Startup migrates before authentication. An empty scratch profile normally
    // refuses the prompt for lack of login; this is initialization, not a model test.
    spawnSync("agy", ["--print", "Return OK.", "--print-timeout", "5s"], {
      env: profile.env,
      encoding: "utf8",
      timeout: 15_000,
    });
  }
  assert.ok(
    fs.existsSync(path.join(profile.root, ".gemini", "config", ".migrated")),
    "agy did not initialize its profile. Start agy in the printed scratch HOME, then retry; do not manufacture a migration marker.",
  );
  // agy startup without login can leave an empty config. Its own management
  // commands finish initialization; the installer must still refuse malformed JSON.
  client("agy", ["mcp", "add", "walrus-profile-init", process.execPath]);
  client("agy", ["mcp", "remove", "walrus-profile-init"]);
  const packed = JSON.parse(
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", profile.root],
      { cwd: repository, encoding: "utf8", shell: process.platform === "win32" },
    ),
  );
  profile.localPackage(path.join(profile.root, packed[0].filename));
  const result = profile.run([
    "install",
    "--silent",
    "--allowed-dirs",
    profile.allowed,
    "--register",
    "claude-code,cursor,codex,antigravity",
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(profile.launcher));
  const claude = client("claude", ["mcp", "get", "walrus-console-mcp"]);
  assert.ok(claude.includes(profile.launcher), claude);
  const health = client("claude", ["mcp", "list"]);
  assert.match(health, /walrus-console-mcp[^\n]*Connected/);
  const codex = JSON.parse(client("codex", ["mcp", "get", "walrus-console-mcp", "--json"]));
  assert.equal(codex.transport.command, profile.launcher);
  assert.deepEqual(codex.transport.args, []);
  const agy = client("agy", ["mcp", "list"]);
  assert.ok(agy.includes("walrus-console-mcp"), agy);
  for (const file of [".cursor/mcp.json", ".gemini/config/mcp_config.json"]) {
    const config = JSON.parse(fs.readFileSync(path.join(profile.root, file), "utf8"));
    assert.deepEqual(config.mcpServers["walrus-console-mcp"], {
      command: profile.launcher,
      args: file.startsWith(".cursor") ? ["--stdio"] : [],
    });
  }
  const cursorEntry = JSON.parse(
    fs.readFileSync(path.join(profile.root, ".cursor", "mcp.json"), "utf8"),
  ).mcpServers["walrus-console-mcp"];
  const transport = new StdioClientTransport({
    command: cursorEntry.command,
    args: cursorEntry.args,
    env: profile.env as Record<string, string>,
  });
  const mcp = new Client({ name: "real-agent-install-check", version: "1.0.0" });
  try {
    await mcp.connect(transport);
    const response = await mcp.callTool({ name: "ping_console", arguments: {} });
    assert.ok(!response.isError);
    const content = response.content as { type: string; text?: string }[];
    const ping = JSON.parse(content.find((item) => item.type === "text")!.text!);
    assert.deepEqual(ping.allowed_dirs, [fs.realpathSync(profile.allowed)]);
    assert.equal(ping.allowed_dirs_source, "file");
  } finally {
    await mcp.close();
  }
  console.log(
    "PASS: real Claude registration + connection; real Codex/agy configuration readback; Cursor configuration and --stdio launcher ping. UI tool discovery still requires the manual checks.",
  );
  if (keep) {
    const envFile = path.join(profile.root, "profile-env.json");
    // Only isolation variables; never persist inherited credentials or PATH.
    fs.writeFileSync(
      envFile,
      JSON.stringify(
        Object.fromEntries(
          [
            "HOME",
            "USERPROFILE",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "APPDATA",
            "LOCALAPPDATA",
            "CLAUDE_CONFIG_DIR",
            "CODEX_HOME",
          ].map((key) => [key, profile.env[key]]),
        ),
        null,
        2,
      ),
    );
    console.log(`Scratch profile kept: ${profile.root}\nIsolation variables: ${envFile}`);
  }
} finally {
  if (!keep) profile.cleanup();
  else console.log(`Scratch HOME: ${profile.root}`);
}
