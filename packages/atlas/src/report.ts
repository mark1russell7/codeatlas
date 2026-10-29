/** The atlas as Markdown, for the summary of a CI run and for a pull request. */
import type { Atlas } from "./atlas.ts";

const percent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

export function atlasMarkdown(atlas: Atlas, options: { readonly top?: number } = {}): string {
  const top = options.top ?? 25;
  const { totals } = atlas;
  const lines: string[] = [
    "# Duplication atlas",
    "",
    `${totals.repos} repositories, ${totals.files} files, ${totals.functions} functions, ${totals.nodes} nodes in the top functions.`,
    `${totals.classes} clone classes of ${atlas.minNodes} nodes or more; ${totals.crossRepoClasses} of them span two or more repositories.`,
    `Duplicated nodes: ${totals.duplicatedNodes} (${percent(totals.ratio)} of all the nodes).`,
    "",
    "## Repositories",
    "",
    "| Repository | Files | Functions | Nodes | Duplicated | Ratio | Cross-repo classes | Parse errors |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...[...atlas.repos]
      .sort((a, b) => b.duplicatedNodes - a.duplicatedNodes)
      .map((row) => `| ${row.repo} | ${row.files} | ${row.functions} | ${row.nodes} | ${row.duplicatedNodes} | ${percent(row.ratio)} | ${row.crossRepoClasses} | ${row.parseErrors} |`),
    "",
    `## The ${top} largest cross-repository clone classes`,
    "",
    "| Nodes | Copies | Repositories | Topics | Members |",
    "|---:|---:|---|---|---|",
    ...atlas.classes
      .filter((cls) => cls.repos.length > 1)
      .slice(0, top)
      .map((cls) => {
        const members = cls.members.slice(0, 4).map((m) => `\`${m.repo}/${m.file}:${m.line}\` ${m.name}`).join("<br>");
        const more = cls.members.length > 4 ? `<br>and ${cls.members.length - 4} more` : "";
        return `| ${cls.nodes} | ${cls.members.length} | ${cls.repos.join(", ")} | ${cls.topics.join(", ")} | ${members}${more} |`;
      }),
    "",
    "## Rigor candidates: clone classes and shared names by topic",
    "",
  ];
  const topics = new Set([...atlas.classes.flatMap((cls) => cls.topics), ...atlas.sharedNames.flatMap((n) => n.topics)]);
  for (const topic of [...topics].sort()) {
    const classes = atlas.classes.filter((cls) => cls.topics.includes(topic));
    const names = atlas.sharedNames.filter((n) => n.topics.includes(topic));
    lines.push(`- **${topic}**: ${classes.length} clone classes (${classes.reduce((s, c) => s + c.duplicatedNodes, 0)} nodes), ${names.length} names in two or more repositories${names.length > 0 ? `: ${names.slice(0, 12).map((n) => `\`${n.name}\` (${n.repos.length})`).join(", ")}` : ""}`);
  }
  lines.push("", "## One purpose, more than one package", "");
  for (const row of atlas.purposes) {
    const entries = Object.entries(row.packages);
    if (entries.length < 2) continue;
    lines.push(`- **${row.purpose}**: ${entries.map(([name, repos]) => `\`${name}\` (${repos.join(", ")})`).join("; ")}`);
  }
  lines.push("", `## Exported names in the most repositories`, "");
  for (const n of atlas.sharedNames.slice(0, top)) lines.push(`- \`${n.name}\` (${n.kinds.join(", ")}): ${n.repos.join(", ")}`);
  return `${lines.join("\n")}\n`;
}
