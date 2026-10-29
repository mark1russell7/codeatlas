/**
 * The page of the codeatlas site. The build compiles this file with swc and puts it into index.html
 * as a module. The functions above `start` are pure, so the tests run them without a browser.
 */
import type { Atlas, CloneClass, Member, RepoRow } from "@mark1russell7/codeatlas";

/** The choices of the filter row of the clone classes. An empty string is "all". */
export interface Filter {
  readonly repo: string;
  readonly repo2: string;
  readonly topic: string;
  readonly query: string;
  readonly crossOnly: boolean;
  readonly hideTests: boolean;
}

export const NO_FILTER: Filter = { repo: "", repo2: "", topic: "", query: "", crossOnly: true, hideTests: false };

/** The topic of a class without a topic. */
export const NO_TOPIC = "no topic";

export function matches(c: CloneClass, f: Filter): boolean {
  if (f.crossOnly && c.repos.length < 2) return false;
  if (f.repo !== "" && !c.repos.includes(f.repo)) return false;
  if (f.repo2 !== "" && !c.repos.includes(f.repo2)) return false;
  if (f.topic === NO_TOPIC ? c.topics.length > 0 : f.topic !== "" && !c.topics.includes(f.topic)) return false;
  if (f.hideTests && c.members.every((m) => m.test)) return false;
  const q = f.query.trim().toLowerCase();
  if (q !== "") return c.members.some((m) => m.name.toLowerCase().includes(q) || m.file.toLowerCase().includes(q));
  return true;
}

/** The code that two repositories share: for each pair, the sum of the size of each class that both have. */
export interface PairShares {
  readonly repos: readonly string[];
  /** shared[i][j]: the nodes of the classes in repos[i] and repos[j]. The diagonal is 0. */
  readonly shared: readonly (readonly number[])[];
  readonly max: number;
}

export function pairShares(atlas: Atlas): PairShares {
  const repos = atlas.repos.filter((r) => r.crossRepoClasses > 0).map((r) => r.repo);
  const index = new Map(repos.map((r, i) => [r, i]));
  const shared = repos.map(() => repos.map(() => 0));
  let max = 0;
  for (const c of atlas.classes) {
    const at = c.repos.map((r) => index.get(r)).filter((i): i is number => i !== undefined);
    for (const i of at) {
      for (const j of at) {
        if (i === j) continue;
        const row = shared[i] as number[];
        row[j] = (row[j] ?? 0) + c.nodes;
        max = Math.max(max, row[j] ?? 0);
      }
    }
  }
  return { repos, shared, max };
}

/** For each topic: the cross-repo classes and their duplicated nodes, the largest first. */
export interface TopicRow {
  readonly topic: string;
  readonly classes: number;
  readonly duplicatedNodes: number;
}

export function topicRows(atlas: Atlas): TopicRow[] {
  const rows = new Map<string, { classes: number; duplicatedNodes: number }>();
  for (const c of atlas.classes) {
    if (c.repos.length < 2) continue;
    for (const topic of c.topics.length > 0 ? c.topics : [NO_TOPIC]) {
      const row = rows.get(topic) ?? { classes: 0, duplicatedNodes: 0 };
      row.classes += 1;
      row.duplicatedNodes += c.duplicatedNodes;
      rows.set(topic, row);
    }
  }
  return [...rows].map(([topic, r]) => ({ topic, ...r })).sort((a, b) => b.duplicatedNodes - a.duplicatedNodes || (a.topic < b.topic ? -1 : 1));
}

/** The step (0 to steps − 1) of a value on a log scale from 1 to max. 0 and less give −1: no color. */
export function stepOf(value: number, max: number, steps: number): number {
  if (value <= 0 || max <= 0) return -1;
  if (max <= 1) return steps - 1;
  return Math.min(steps - 1, Math.floor((Math.log(value) / Math.log(max)) * steps));
}

/** The link to a member at the commit that the scan read. */
export function sourceUrl(owner: string, commit: string | null, m: Member): string {
  const path = m.file.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${owner}/${encodeURIComponent(m.repo)}/blob/${commit ?? "HEAD"}/${path}#L${m.line}`;
}

/** The title of a class: the first member that has a name, else the file name of the first member. */
export function titleOf(c: CloneClass): string {
  const named = c.members.find((m) => m.name !== "<anonymous>");
  if (named !== undefined) return named.name;
  const first = c.members[0];
  return first === undefined ? c.hash : `<anonymous> in ${first.file.split("/").pop() ?? first.file}`;
}

export const int = (n: number): string => Math.round(n).toLocaleString("en-US");
export const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

// ─── The page ────────────────────────────────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const HEAT_STEPS = 7;
const PAGE_SIZE = 60;

function tooltip(): { show(e: MouseEvent | FocusEvent, text: string): void; hide(): void } {
  const tip = h("div", { class: "tip", role: "status" });
  document.body.append(tip);
  return {
    show(e, text) {
      tip.textContent = text;
      tip.style.display = "block";
      const box = (e.target as Element).getBoundingClientRect();
      const x = e instanceof MouseEvent && e.clientX > 0 ? e.clientX : box.left + box.width / 2;
      const y = e instanceof MouseEvent && e.clientY > 0 ? e.clientY : box.top;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
      tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12) + window.scrollY}px`;
    },
    hide() {
      tip.style.display = "none";
    },
  };
}

export async function start(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  const owner = root.dataset["owner"] ?? "";
  let atlas: Atlas;
  try {
    const res = await fetch("data/atlas.json");
    atlas = (await res.json()) as Atlas;
  } catch {
    root.replaceChildren(h("p", { class: "empty" }, "The atlas data did not load."));
    return;
  }
  const commits = new Map(atlas.repos.map((r) => [r.repo, r.commit]));
  const tip = tooltip();
  let filter: Filter = NO_FILTER;
  let shown = PAGE_SIZE;

  const classesBox = h("div", { class: "classes" });
  const countLine = h("p", { class: "count" });
  const controls = buildControls();

  function setFilter(next: Partial<Filter>, scroll = false): void {
    filter = { ...filter, ...next };
    shown = PAGE_SIZE;
    syncControls();
    renderClasses();
    if (scroll) document.getElementById("classes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The totals.
  const t = atlas.totals;
  const kpis = h(
    "div",
    { class: "kpis" },
    kpi(pct(t.ratio), "of the code is a copy", `${int(t.duplicatedNodes)} of ${int(t.nodes)} syntax nodes`),
    kpi(int(t.crossRepoClasses), "clone classes span repos", `of ${int(t.classes)} classes of ${atlas.minNodes} nodes or more`),
    kpi(int(t.repos), "public repositories", `${int(t.files)} files, ${int(t.functions)} functions`),
  );

  // The topics: what a shared library would remove.
  const allTopics = topicRows(atlas);
  const topics = allTopics.filter((r) => r.topic !== NO_TOPIC);
  const untopiced = allTopics.find((r) => r.topic === NO_TOPIC);
  const topicMax = Math.max(1, ...topics.map((r) => r.duplicatedNodes));
  const topicChart = h("div", { class: "bars", role: "list" });
  for (const row of topics) {
    const bar = h("button", { class: "bar-row", type: "button", role: "listitem" },
      h("span", { class: "bar-label" }, row.topic),
      h("span", { class: "bar-track" }, h("span", { class: "bar", style: `width:${Math.max(1, (row.duplicatedNodes / topicMax) * 100)}%` })),
      h("span", { class: "bar-value" }, int(row.duplicatedNodes)),
    );
    const text = `${row.topic}: ${int(row.duplicatedNodes)} duplicated nodes in ${row.classes} cross-repo classes. Click to list them.`;
    bar.addEventListener("mouseenter", (e) => tip.show(e, text));
    bar.addEventListener("focus", (e) => tip.show(e, text));
    bar.addEventListener("mouseleave", () => tip.hide());
    bar.addEventListener("blur", () => tip.hide());
    bar.addEventListener("click", () => setFilter({ ...NO_FILTER, topic: row.topic }, true));
    topicChart.append(bar);
  }
  if (untopiced !== undefined) {
    const rest = h("button", { type: "button", class: "link" }, `${int(untopiced.duplicatedNodes)} more duplicated nodes in ${int(untopiced.classes)} classes have no topic. List them.`);
    rest.addEventListener("click", () => setFilter({ ...NO_FILTER, topic: NO_TOPIC }, true));
    topicChart.append(h("p", { class: "rest" }, rest));
  }

  // The pairs of repositories.
  const pairs = pairShares(atlas);
  const heat = heatmap(pairs);

  // The repositories.
  const repoTable = repoTableOf(atlas.repos);

  // The shared names and the packages by purpose.
  const names = h("div", { class: "chips" });
  for (const n of atlas.sharedNames.slice(0, 80)) {
    const chip = h("span", { class: "chip", tabindex: "0" }, n.name, h("b", {}, String(n.repos.length)));
    const text = `${n.name} (${n.kinds.join(", ")}): ${n.repos.join(", ")}`;
    chip.addEventListener("mouseenter", (e) => tip.show(e, text));
    chip.addEventListener("focus", (e) => tip.show(e, text));
    chip.addEventListener("mouseleave", () => tip.hide());
    chip.addEventListener("blur", () => tip.hide());
    names.append(chip);
  }
  const purposes = h("table", { class: "table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Purpose"), h("th", {}, "Packages (repositories that import each)"))),
    h("tbody", {}, ...atlas.purposes.map((p) => {
      const pkgs = Object.entries(p.packages);
      return h("tr", {},
        h("td", {}, p.purpose, pkgs.length > 1 ? h("span", { class: "flag" }, "split") : pkgs.length === 0 ? h("span", { class: "flag quiet" }, "hand-written") : null),
        h("td", {}, pkgs.length === 0 ? "No package: each repository writes its own." : pkgs.map(([pkg, repos]) => `${pkg} (${repos.length})`).join(", ")),
      );
    })),
  );

  root.replaceChildren(
    kpis,
    section("topics", "Where the copies are", "Duplicated nodes of the cross-repo classes, by topic. Each topic is an area of a shared library. Click a bar to list its classes.", topicChart),
    section("pairs", "Which repositories share code", "Each cell is the size of the code that two repositories both have: the legend below gives the scale. Click a cell to list the classes of the pair.", heat),
    section("repos", "Repositories", "Click a column to sort and a row to list its classes. The ratio is the share of the code of the repository that is a copy.", repoTable),
    section("classes", "Clone classes", "Functions with one shape: the same code, with other names, literals or types. The largest first.", controls, countLine, classesBox),
    section("names", "Names that two or more repositories export", "The number is the count of repositories.", names),
    section("purposes", "Packages by purpose", "Two packages for one purpose show a split. No package shows code that each repository writes again.", purposes),
  );
  renderClasses();

  function kpi(value: string, label: string, detail: string): HTMLElement {
    return h("div", { class: "kpi" }, h("div", { class: "kpi-value" }, value), h("div", { class: "kpi-label" }, label), h("div", { class: "kpi-detail" }, detail));
  }

  function section(id: string, title: string, lead: string, ...body: Child[]): HTMLElement {
    return h("section", { id }, h("h2", {}, title), h("p", { class: "lead" }, lead), ...body);
  }

  function heatmap(p: PairShares): HTMLElement {
    const cell = 20;
    const label = 160;
    const n = p.repos.length;
    const size = label + n * cell;
    const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": "Shared code of each pair of repositories" }) as SVGSVGElement;
    p.repos.forEach((repo, i) => {
      const left = s("text", { x: label - 6, y: label + i * cell + cell / 2, class: "axis", "text-anchor": "end", "dominant-baseline": "central" });
      left.textContent = repo;
      const top = s("text", { x: 0, y: 0, class: "axis", transform: `translate(${label + i * cell + cell / 2} ${label - 6}) rotate(-90)`, "dominant-baseline": "central" });
      top.textContent = repo;
      svg.append(left, top);
      p.repos.forEach((other, j) => {
        const value = p.shared[i]?.[j] ?? 0;
        const step = stepOf(value, p.max, HEAT_STEPS);
        const rect = s("rect", {
          x: label + j * cell + 1, y: label + i * cell + 1, width: cell - 2, height: cell - 2, rx: 2,
          class: step < 0 ? "cell none" : `cell s${step}`,
        });
        if (step >= 0) {
          rect.setAttribute("tabindex", "0");
          const text = `${repo} and ${other}: ${int(value)} nodes of shared code`;
          rect.addEventListener("mouseenter", (e) => tip.show(e as MouseEvent, text));
          rect.addEventListener("focus", (e) => tip.show(e as FocusEvent, text));
          rect.addEventListener("mouseleave", () => tip.hide());
          rect.addEventListener("blur", () => tip.hide());
          rect.addEventListener("click", () => setFilter({ ...NO_FILTER, repo, repo2: other }, true));
        }
        svg.append(rect);
      });
    });
    const legend = h("div", { class: "legend" }, "less", ...Array.from({ length: HEAT_STEPS }, (_, k) => h("span", { class: `swatch s${k}` })), "more");
    return h("div", {}, h("div", { class: "scroll" }, svg), legend);
  }

  function repoTableOf(rows: readonly RepoRow[]): HTMLElement {
    type Key = "repo" | "functions" | "duplicatedNodes" | "ratio" | "crossRepoClasses";
    const cols: { key: Key; title: string }[] = [
      { key: "repo", title: "Repository" },
      { key: "functions", title: "Functions" },
      { key: "duplicatedNodes", title: "Copied nodes" },
      { key: "ratio", title: "Ratio" },
      { key: "crossRepoClasses", title: "Shared classes" },
    ];
    let sortKey: Key = "duplicatedNodes";
    let desc = true;
    const maxRatio = Math.max(0.0001, ...rows.map((r) => r.ratio));
    const head = h("tr", {});
    const body = h("tbody", {});
    const table = h("table", { class: "table sortable" }, h("thead", {}, head), body);
    function render(): void {
      head.replaceChildren(...cols.map((c) => {
        const btn = h("button", { type: "button" }, c.title, c.key === sortKey ? (desc ? " ↓" : " ↑") : "");
        btn.addEventListener("click", () => {
          desc = c.key === sortKey ? !desc : c.key !== "repo";
          sortKey = c.key;
          render();
        });
        return h("th", { "aria-sort": c.key === sortKey ? (desc ? "descending" : "ascending") : "none" }, btn);
      }));
      const sorted = [...rows].filter((r) => r.functions > 0).sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
        return desc ? -order : order;
      });
      body.replaceChildren(...sorted.map((r) => {
        const tr = h("tr", { tabindex: "0" },
          h("td", {}, r.repo),
          h("td", { class: "num" }, int(r.functions)),
          h("td", { class: "num" }, int(r.duplicatedNodes)),
          h("td", { class: "num" }, h("span", { class: "ratio" }, h("span", { class: "track" }, h("span", { class: "mini", style: `width:${(r.ratio / maxRatio) * 100}%` })), pct(r.ratio))),
          h("td", { class: "num" }, int(r.crossRepoClasses)),
        );
        const pick = (): void => setFilter({ ...NO_FILTER, repo: r.repo, crossOnly: false }, true);
        tr.addEventListener("click", pick);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
        return tr;
      }));
    }
    render();
    return h("div", { class: "scroll" }, table);
  }

  function buildControls(): HTMLElement {
    const repos = atlas.repos.filter((r) => r.functions > 0).map((r) => r.repo);
    const topicNames = [...new Set(atlas.classes.flatMap((c) => c.topics))].sort().concat(NO_TOPIC);
    const select = (id: string, all: string, values: readonly string[]): HTMLSelectElement =>
      h("select", { id, "aria-label": all }, h("option", { value: "" }, all), ...values.map((v) => h("option", { value: v }, v)));
    const repo = select("f-repo", "All repositories", repos);
    const repo2 = select("f-repo2", "With any repository", repos);
    const topic = select("f-topic", "All topics", topicNames);
    const query = h("input", { id: "f-query", type: "search", placeholder: "Search names and paths", "aria-label": "Search" });
    const cross = h("input", { id: "f-cross", type: "checkbox" });
    const tests = h("input", { id: "f-tests", type: "checkbox" });
    const reset = h("button", { type: "button", class: "reset" }, "Clear");
    repo.addEventListener("change", () => setFilter({ repo: repo.value }));
    repo2.addEventListener("change", () => setFilter({ repo2: repo2.value }));
    topic.addEventListener("change", () => setFilter({ topic: topic.value }));
    query.addEventListener("input", () => setFilter({ query: query.value }));
    cross.addEventListener("change", () => setFilter({ crossOnly: cross.checked }));
    tests.addEventListener("change", () => setFilter({ hideTests: tests.checked }));
    reset.addEventListener("click", () => setFilter(NO_FILTER));
    return h("div", { class: "filters" }, repo, repo2, topic, query,
      h("label", {}, cross, " Across repos only"), h("label", {}, tests, " Hide tests"), reset);
  }

  function syncControls(): void {
    (document.getElementById("f-repo") as HTMLSelectElement).value = filter.repo;
    (document.getElementById("f-repo2") as HTMLSelectElement).value = filter.repo2;
    (document.getElementById("f-topic") as HTMLSelectElement).value = filter.topic;
    const q = document.getElementById("f-query") as HTMLInputElement;
    if (q.value !== filter.query) q.value = filter.query;
    (document.getElementById("f-cross") as HTMLInputElement).checked = filter.crossOnly;
    (document.getElementById("f-tests") as HTMLInputElement).checked = filter.hideTests;
  }

  function renderClasses(): void {
    syncControls();
    const list = atlas.classes.filter((c) => matches(c, filter));
    const nodes = list.reduce((sum, c) => sum + c.duplicatedNodes, 0);
    countLine.textContent = `${int(list.length)} classes, ${int(nodes)} duplicated nodes.`;
    classesBox.replaceChildren(...list.slice(0, shown).map(classCard));
    if (list.length > shown) {
      const more = h("button", { type: "button", class: "more" }, `Show ${Math.min(PAGE_SIZE, list.length - shown)} more`);
      more.addEventListener("click", () => {
        shown += PAGE_SIZE;
        renderClasses();
      });
      classesBox.append(more);
    }
    if (list.length === 0) classesBox.append(h("p", { class: "empty" }, "No class matches the filter."));
  }

  function classCard(c: CloneClass): HTMLElement {
    const title = titleOf(c);
    return h("details", { class: "card" },
      h("summary", {},
        h("span", { class: "card-title" }, title),
        h("span", { class: "card-meta" }, `${c.members.length} copies · ${c.nodes} nodes · ${c.repos.length} repos`),
        ...c.topics.map((topic) => h("span", { class: "tag" }, topic)),
      ),
      h("ul", {}, ...c.members.map((m) =>
        h("li", {}, h("a", { href: sourceUrl(owner, commits.get(m.repo) ?? null, m), target: "_blank", rel: "noopener" }, `${m.repo}/${m.file}:${m.line}`), " ", h("code", {}, m.name), m.test ? h("span", { class: "tag quiet" }, "test") : null),
      )),
    );
  }
}

if (typeof document !== "undefined") void start();
