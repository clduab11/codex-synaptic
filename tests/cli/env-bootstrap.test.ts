import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import {
  bootstrapCliEnv,
  buildCliEnvBootstrapMessages,
  loadEnvFile,
  shouldAutoLoadCliEnv,
  shouldShowCliEnvBanner,
} from "../../src/cli/env-bootstrap";

describe("cli env bootstrap helper", () => {
  it("does not override existing environment variables", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-env-bootstrap-"));
    const envPath = join(tempDir, ".env");
    writeFileSync(envPath, "EXISTING_KEY=from-file\nNEW_KEY=from-file\n");

    const env: NodeJS.ProcessEnv = {
      EXISTING_KEY: "from-env",
    };

    const applied = loadEnvFile(envPath, env);
    expect(applied).toBe(true);
    expect(env.EXISTING_KEY).toBe("from-env");
    expect(env.NEW_KEY).toBe("from-file");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("autoload is enabled by default and can be disabled explicitly", () => {
    expect(shouldAutoLoadCliEnv({})).toBe(true);
    expect(shouldAutoLoadCliEnv({ CODEX_CLI_ENV_AUTOLOAD: "0" })).toBe(false);
    expect(shouldAutoLoadCliEnv({ CODEX_CLI_ENV_AUTOLOAD: "false" })).toBe(
      false,
    );
    expect(shouldAutoLoadCliEnv({ CODEX_CLI_ENV_AUTOLOAD: "1" })).toBe(true);
  });

  it("suppresses env banner in json mode unless forced", () => {
    expect(
      shouldShowCliEnvBanner({
        env: {},
        cliSilent: false,
        argv: ["node", "dist/cli/index.js", "doctor", "--json"],
      }),
    ).toBe(false);

    expect(
      shouldShowCliEnvBanner({
        env: { CODEX_CLI_ENV_BANNER_FORCE: "1" },
        cliSilent: false,
        argv: ["node", "dist/cli/index.js", "doctor", "--json"],
      }),
    ).toBe(true);
  });

  it("builds sanitized banner messages by default and verbose paths on opt-in", () => {
    const cwd = "/repo";
    const sources = ["/repo/.env.local", "/repo/src/cli/.env"];

    const defaultMessages = buildCliEnvBootstrapMessages(sources, {
      cwd,
      env: {},
    });
    expect(defaultMessages[0]).toContain("local .env file(s)");
    expect(defaultMessages[0]).toContain("(2)");
    expect(defaultMessages[0]).not.toContain("src/cli/.env");
    expect(defaultMessages.some((line) => line.includes("src/cli/.env"))).toBe(
      true,
    );
    expect(
      defaultMessages.some((line) => line.includes("CODEX_CLI_ENV_AUTOLOAD=0")),
    ).toBe(true);

    const verboseMessages = buildCliEnvBootstrapMessages(sources, {
      cwd,
      env: { CODEX_CLI_ENV_BANNER_VERBOSE: "1" },
    });
    expect(verboseMessages[0]).toContain(".env.local");
    expect(verboseMessages[0]).toContain("src/cli/.env");
  });

  it("bootstraps candidate env files in precedence order without duplicates", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex-env-bootstrap-"));
    writeFileSync(join(tempDir, ".env"), "BASE_KEY=base\n");
    writeFileSync(
      join(tempDir, ".env.local"),
      "BASE_KEY=local-override-ignored\nLOCAL_KEY=local\n",
    );
    const srcCliDir = join(tempDir, "src", "cli");
    mkdirSync(srcCliDir, { recursive: true });
    writeFileSync(join(tempDir, "src", "cli", ".env"), "CLI_KEY=cli\n", {
      flag: "w",
    });

    const env: NodeJS.ProcessEnv = {};
    const sources = bootstrapCliEnv({ cwd: tempDir, env });

    expect(sources.map((source) => source.replace(`${tempDir}/`, ""))).toEqual([
      ".env",
      ".env.local",
      "src/cli/.env",
    ]);
    expect(env.BASE_KEY).toBe("base");
    expect(env.LOCAL_KEY).toBe("local");
    expect(env.CLI_KEY).toBe("cli");

    rmSync(tempDir, { recursive: true, force: true });
  });
});
