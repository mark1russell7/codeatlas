/**
 * The commands of the tools of agents (CA16). The command mcp serves the tools over MCP on the standard input and
 * output. The command tool calls one tool and writes its answer as JSON.
 */
import { readFileSync } from "node:fs";
import { callerOf } from "@procedures/client";
import { createMcpHost } from "@procedures/mcp-server";
import { queryOf } from "./query.ts";
import { readOnlyCatalog } from "./store.ts";
import { atlasTools } from "./tools.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** The instructions of the MCP server. The MCP client gives them to the model. */
export const MCP_INSTRUCTIONS: string =
  "The tools answer questions of the codeatlas catalog of the public repositories. Ask them before you read code again. " +
  "Before you write a helper, call atlas.find with its name: it gives the copies of each function and the home of its name. " +
  "atlas.copies gives the copies of one function, atlas.homes gives the functions outside their homes, and atlas.importers gives the users of a package.";

const flag = (argv: readonly string[], name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

/** This function serves the tools over the catalog `--db` as MCP tools on the standard input and output, until the input ends. */
export async function mcpCommand(argv: readonly string[]): Promise<number> {
  const db = flag(argv, "--db");
  if (db === undefined) {
    console.error("Usage: codeatlas mcp --db <catalog.sqlite>");
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const tools = atlasTools(queryOf(catalog));
    const host = createMcpHost({
      modules: [tools.module],
      surface: { namespaces: ["atlas"] },
      readOnly: true,
      name: "codeatlas",
      version: VERSION,
      instructions: MCP_INSTRUCTIONS,
      json: "compact",
    });
    await host.start();
    console.error(`codeatlas mcp: ${host.tools().length} tools over stdio, catalog ${db}`);
    await host.closed;
    return 0;
  } finally {
    catalog.close();
  }
}

/**
 * This function calls the tool `<name>` (for example `find` or `atlas.find`) with the JSON input `<input>` over the
 * catalog `--db`, and writes the answer as JSON. Its exit code is 1 when the tool refuses the input.
 */
export async function toolCommand(argv: readonly string[]): Promise<number> {
  const db = flag(argv, "--db");
  const positional = argv.filter((arg, i) => arg !== "--db" && argv[i - 1] !== "--db");
  const [name, text = "{}"] = positional;
  if (db === undefined || name === undefined) {
    console.error("Usage: codeatlas tool <name> [<json input>] --db <catalog.sqlite>");
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    console.error(`The input is not JSON: ${text}`);
    return 2;
  }
  const catalog = readOnlyCatalog(db);
  try {
    const call = callerOf(atlasTools(queryOf(catalog)).module);
    const path = name.startsWith("atlas.") ? name.split(".") : ["atlas", name];
    console.log(JSON.stringify(await call(path, input), null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    catalog.close();
  }
}
