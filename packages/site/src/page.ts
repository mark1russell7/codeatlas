/**
 * The page of the codeatlas site. The build compiles this file with swc and puts it into index.html
 * as a module. The functions above `start` are pure, so the tests run them without a browser.
 */
import type { Atlas, CloneClass, CloneLevel, ComplexFunction, DimensionCatalog, FunctionPlace, HomeCandidate, Member, QuerySet, RepoRow, Trend } from "@mark1russell7/codeatlas";

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

/** The duplication of one level of the chain of clone hashes, with its name for the page. */
export interface LevelRow {
  readonly level: CloneLevel;
  readonly title: string;
  readonly classes: number;
  readonly members: number;
  readonly duplicatedNodes: number;
  readonly ratio: number;
}

const LEVEL_TITLES: Readonly<Record<CloneLevel, string>> = {
  exact: "The same code, character for character",
  renamed: "The same code with other names",
  shape: "The same shape, with other literals and types",
};

/** This function gives one row for each level of the query set, in the order of the chain. */
export function levelRows(set: QuerySet): LevelRow[] {
  const levels: readonly CloneLevel[] = ["exact", "renamed", "shape"];
  return levels.map((level) => ({ level, title: LEVEL_TITLES[level], ...set.duplication.levels[level], ratio: set.duplication.ratio[level] }));
}

/** One dimension of the catalog, as the page shows it. */
export interface DimensionLine {
  readonly id: string;
  readonly title: string;
  readonly definition: string;
  readonly unit: string;
  readonly counts: boolean;
  /** The agreement of the check as text, or "not checked". */
  readonly precision: string;
  readonly median: number | null;
  readonly p95: number | null;
  readonly gap: { readonly cause: string; readonly next: string; readonly item: string } | null;
}

/** This function gives the lines of the dimension catalog: the dimensions that count first, then the gaps. */
export function dimensionLines(catalog: DimensionCatalog): DimensionLine[] {
  const lines = catalog.dimensions.map((d): DimensionLine => ({
    id: d.id,
    title: d.title,
    definition: d.definition,
    unit: d.unit,
    counts: d.counts,
    precision: d.precision === null ? "not checked" : `${d.precision.agree} of ${d.precision.checked}`,
    median: d.summary === null || d.summary.count === 0 ? null : d.summary.median,
    p95: d.summary === null || d.summary.count === 0 ? null : d.summary.p95,
    gap: d.counts ? null : (d.gap ?? null),
  }));
  return [...lines.filter((d) => d.counts), ...lines.filter((d) => !d.counts)];
}

/** The markers of each repository: one count for each kind. */
export interface MarkerTable {
  readonly kinds: readonly string[];
  readonly rows: readonly { readonly repo: string; readonly counts: Readonly<Record<string, number>>; readonly total: number }[];
}

/** This function gives the markers as a table, the repository with the most markers first. */
export function markerTable(set: QuerySet): MarkerTable {
  const kinds = [...new Set(set.markers.map((m) => m.kind))].sort();
  const byRepo = new Map<string, Record<string, number>>();
  for (const m of set.markers) {
    const counts = byRepo.get(m.repo) ?? {};
    counts[m.kind] = (counts[m.kind] ?? 0) + m.count;
    byRepo.set(m.repo, counts);
  }
  const rows = [...byRepo].map(([repo, counts]) => ({ repo, counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) }));
  rows.sort((a, b) => b.total - a.total || (a.repo < b.repo ? -1 : 1));
  return { kinds, rows };
}

/** The place of a function of the catalog as a member of the page, for its link. */
export const placeOf = (f: FunctionPlace): Pick<Member, "repo" | "file" | "line"> => ({ repo: f.repo, file: f.path, line: f.line });

/** The link to a member at the commit that the scan read. */
export function sourceUrl(owner: string, commit: string | null, m: Pick<Member, "repo" | "file" | "line">): string {
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

/** One point of the trend of all repositories: the nodes, the duplicated nodes of one level and their ratio. */
export interface TrendRow {
  readonly at: string;
  readonly nodes: number;
  readonly duplicated: number;
  readonly ratio: number;
}

/** This function gives the totals of each point of the trend, in the order of time. */
export function trendRows(trend: Trend, level: CloneLevel = "renamed"): TrendRow[] {
  return trend.points.map((point) => {
    // A filtered point keeps the totals from before the filter. Each other point has its totals in its rows.
    const nodes = point.totals?.nodes ?? point.repos.reduce((sum, repo) => sum + repo.nodes, 0);
    const duplicated = point.totals?.duplicated[level] ?? point.repos.reduce((sum, repo) => sum + repo.duplicated[level], 0);
    return { at: point.at, nodes, duplicated, ratio: nodes === 0 ? 0 : duplicated / nodes };
  });
}

/** The ratio of one repository at the first point that has it, and at the last point. */
export interface RepoChange {
  readonly repo: string;
  readonly first: number;
  readonly last: number;
  /** The value `last − first`. A positive change tells that the share of copies grew. */
  readonly change: number;
}

/** This function gives the change of each repository of the last point, the largest growth first. */
export function repoChanges(trend: Trend, level: CloneLevel = "renamed"): RepoChange[] {
  const ratio = (repo: { readonly nodes: number; readonly duplicated: Readonly<Record<CloneLevel, number>> }): number =>
    repo.nodes === 0 ? 0 : repo.duplicated[level] / repo.nodes;
  const last = trend.points[trend.points.length - 1];
  if (last === undefined) return [];
  return last.repos
    .filter((repo) => repo.nodes > 0)
    .map((repo) => {
      const firstPoint = trend.points.find((point) => point.repos.some((each) => each.repo === repo.repo && each.nodes > 0));
      const before = firstPoint?.repos.find((each) => each.repo === repo.repo);
      const first = before === undefined ? ratio(repo) : ratio(before);
      return { repo: repo.repo, first, last: ratio(repo), change: ratio(repo) - first };
    })
    .sort((a, b) => b.change - a.change || (a.repo < b.repo ? -1 : 1));
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
  // A wide table scrolls in its own box, so the page does not scroll sideways on a phone. The class scroll-cue shows a shade
  // at each edge that has more content.
  const purposes = h("div", { class: "scroll scroll-cue" }, h("table", { class: "table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Purpose"), h("th", {}, "Packages (repositories that import each)"))),
    h("tbody", {}, ...atlas.purposes.map((p) => {
      const pkgs = Object.entries(p.packages);
      return h("tr", {},
        h("td", {}, p.purpose, pkgs.length > 1 ? h("span", { class: "flag" }, "split") : pkgs.length === 0 ? h("span", { class: "flag quiet" }, "hand-written") : null),
        h("td", {}, pkgs.length === 0 ? "No package: each repository writes its own." : pkgs.map(([pkg, repos]) => `${pkg} (${repos.length})`).join(", ")),
      );
    })),
  ));

  // An atlas of an older build has no homed list
  const homedRows = atlas.homed ?? [];
  const homed = homedRows.length === 0
    ? h("p", {}, "No copies.")
    : h("div", { class: "scroll scroll-cue" }, h("table", { class: "table wide" },
        h("thead", {}, h("tr", {}, h("th", {}, "Area"), h("th", {}, "Home"), h("th", {}, "Copies"), h("th", {}, "Repositories (copies)"))),
        h("tbody", {}, ...homedRows.map((row) =>
          h("tr", {},
            h("td", {}, row.title),
            h("td", {}, row.home.join(", ")),
            h("td", {}, String(row.copies.length)),
            h("td", {}, row.repos.map((repo) => `${repo} (${row.copies.filter((copy) => copy.repo === repo).length})`).join(", ")),
          ),
        )),
      ));

  const trendBox = h("div", { class: "trend" }, h("p", { class: "empty" }, "Loading the trend."));
  void loadTrend();

  const loading = (): HTMLElement => h("p", { class: "empty" }, "Loading the query set.");
  const levelsBox = h("div", {}, loading());
  const exactBox = h("div", { class: "classes" }, loading());
  const complexBox = h("div", {}, loading());
  const markersBox = h("div", {}, loading());
  // The table of the atlas stays until the query set gives the copies with their sizes
  const homesBox = h("div", { class: "classes" }, homed);
  void loadQueries();

  const dimensionsBox = h("div", {}, h("p", { class: "empty" }, "Loading the dimensions."));
  void loadDimensions();

  root.replaceChildren(
    kpis,
    section("homes", "Copies that have a home", "Functions whose name is a signature of a home package of the map of homes, outside that home. The size is the nodes that the imports remove. The fix is an import from the home, or a pull request that adds the function to the home.", homesBox),
    section("topics", "Where the copies are", "Duplicated nodes of the cross-repo classes, by topic. Each topic is an area of a shared library. Click a bar to list its classes.", topicChart),
    section("pairs", "Which repositories share code", "Each cell is the size of the code that two repositories both have: the legend below gives the scale. Click a cell to list the classes of the pair.", heat),
    section("trend", "The trend", "The share of the code that is a copy, at each build. A class keeps its first function, and each other function counts as a copy.", trendBox),
    section("levels", "Copies at each level", "Each level of the chain finds more copies than the level before it. A function of a class at one level is in a class at each next level.", levelsBox),
    section("exact", "Exact copies", "The same code, character for character after the format. Each of these functions can be one import. The largest first.", exactBox),
    section("repos", "Repositories", "Click a column to sort and a row to list its classes. The ratio is the share of the code of the repository that is a copy.", repoTable),
    section("classes", "Clone classes", "Functions with one shape: the same code, with other names, literals or types. The largest first.", controls, countLine, classesBox),
    section("names", "Names that two or more repositories export", "The number is the count of repositories.", names),
    section("purposes", "Packages by purpose", "Two packages for one purpose show a split. No package shows code that each repository writes again.", purposes),
    section("complex", "Complex functions", "Functions outside tests with many paths. The complexity is the count of paths, and the depth is the deepest nesting. Click a column to sort.", complexBox),
    section("dimensions", "Dimensions", "Each dimension is an attribute of each function. A dimension counts only when an independent tool agrees with its values. Each gap has its cause and its next step.", dimensionsBox),
    section("markers", "Markers", "The count of each kind of marker in each repository, test files included. A marker is a comment such as TODO, or a code form such as a non-null assertion.", markersBox),
  );
  renderClasses();

  async function loadTrend(): Promise<void> {
    let trend: Trend;
    try {
      const res = await fetch("data/trend.json");
      if (!res.ok) throw new Error(String(res.status));
      trend = (await res.json()) as Trend;
    } catch {
      trendBox.replaceChildren(h("p", { class: "empty" }, "The trend data did not load."));
      return;
    }
    const rows = trendRows(trend);
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first === undefined || last === undefined) {
      trendBox.replaceChildren(h("p", { class: "empty" }, "The trend has no point yet."));
      return;
    }
    const note =
      rows.length === 1
        ? `The trend starts on ${first.at.slice(0, 10)}. Each build adds a point, one for each day.`
        : `${rows.length} points from ${first.at.slice(0, 10)} to ${last.at.slice(0, 10)}.`;
    trendBox.replaceChildren(trendChart(rows), h("p", { class: "count" }, note), changeTable(repoChanges(trend), rows.length > 1));
  }

  function trendChart(rows: readonly TrendRow[]): SVGSVGElement {
    const width = 640;
    const height = 200;
    const pad = { left: 44, right: 16, top: 12, bottom: 24 };
    // The axis ends at the next whole percent above the largest ratio.
    const max = Math.ceil(Math.max(0.01, ...rows.map((row) => row.ratio)) * 100) / 100;
    const x = (i: number): number => (rows.length === 1 ? (pad.left + width - pad.right) / 2 : pad.left + (i / (rows.length - 1)) * (width - pad.left - pad.right));
    const y = (ratio: number): number => pad.top + (1 - ratio / max) * (height - pad.top - pad.bottom);
    const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "trend-chart", role: "img", "aria-label": "The share of the code that is a copy, at each build" }) as SVGSVGElement;
    for (const tick of [0, max / 2, max]) {
      svg.append(s("line", { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: "grid" }));
      const label = s("text", { x: pad.left - 6, y: y(tick), class: "axis", "text-anchor": "end", "dominant-baseline": "central" });
      label.textContent = pct(tick);
      svg.append(label);
    }
    for (const i of rows.length === 1 ? [0] : [0, rows.length - 1]) {
      const label = s("text", { x: x(i), y: height - 6, class: "axis", "text-anchor": rows.length === 1 ? "middle" : i === 0 ? "start" : "end" });
      label.textContent = (rows[i] as TrendRow).at.slice(0, 10);
      svg.append(label);
    }
    if (rows.length > 1) svg.append(s("path", { d: rows.map((row, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(row.ratio)}`).join(""), class: "trend-line" }));
    const cross = s("line", { y1: pad.top, y2: height - pad.bottom, class: "cross", visibility: "hidden" });
    svg.append(cross);
    const step = rows.length === 1 ? width : (width - pad.left - pad.right) / (rows.length - 1);
    rows.forEach((row, i) => {
      svg.append(s("circle", { cx: x(i), cy: y(row.ratio), r: 4, class: "trend-dot" }));
      // The hit target is the full column of the point, so the pointer finds it with no aim.
      const hit = s("rect", { x: x(i) - step / 2, y: 0, width: step, height, class: "hit", tabindex: 0 });
      const text = `${row.at.slice(0, 10)}: ${pct(row.ratio)} of the code is a copy (${int(row.duplicated)} of ${int(row.nodes)} nodes).`;
      const show = (e: Event): void => {
        cross.setAttribute("x1", String(x(i)));
        cross.setAttribute("x2", String(x(i)));
        cross.setAttribute("visibility", "visible");
        tip.show(e as MouseEvent, text);
      };
      const hide = (): void => {
        cross.setAttribute("visibility", "hidden");
        tip.hide();
      };
      hit.addEventListener("mouseenter", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("mouseleave", hide);
      hit.addEventListener("blur", hide);
      svg.append(hit);
    });
    return svg;
  }

  function changeTable(changes: readonly RepoChange[], history: boolean): HTMLElement {
    const head = history ? ["Repository", "First", "Now", "Change"] : ["Repository", "Now"];
    const signed = (n: number): string => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;
    return h("div", { class: "scroll scroll-cue" },
      h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ...head.map((title, i) => h("th", i === 0 ? {} : { class: "num" }, title)))),
        h("tbody", {}, ...changes.map((row) =>
          h("tr", {},
            h("td", {}, row.repo),
            history ? h("td", { class: "num" }, pct(row.first)) : null,
            h("td", { class: "num" }, pct(row.last)),
            history ? h("td", { class: "num" }, signed(row.change)) : null,
          ),
        )),
      ),
    );
  }

  async function loadDimensions(): Promise<void> {
    let catalog: DimensionCatalog;
    try {
      const res = await fetch("data/dimensions.json");
      if (!res.ok) throw new Error(String(res.status));
      catalog = (await res.json()) as DimensionCatalog;
    } catch {
      dimensionsBox.replaceChildren(h("p", { class: "empty" }, "The dimensions did not load."));
      return;
    }
    const lines = dimensionLines(catalog);
    const counted = lines.filter((d) => d.counts).length;
    const value = (n: number | null): string => (n === null ? "" : String(Math.round(n * 10) / 10));
    const gaps = lines.filter((d) => d.gap !== null);
    dimensionsBox.replaceChildren(
      h("p", { class: "count" }, `${counted} of ${lines.length} dimensions count. The gate is a Wilson lower bound of ${catalog.gate} on a sample of 200.`),
      h("div", { class: "scroll scroll-cue" },
        h("table", { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Dimension"), h("th", {}, "State"), h("th", { class: "num" }, "Agreement"), h("th", { class: "num" }, "Median"), h("th", { class: "num" }, "95th percentile"))),
          h("tbody", {}, ...lines.map((d) =>
            h("tr", {},
              h("td", {}, h("strong", {}, d.title), h("div", { class: "cell-sub" }, `${d.definition} Unit: ${d.unit}.`)),
              h("td", {}, h("span", { class: d.counts ? "chip state-ok" : "chip state-gap" }, d.counts ? "✓ counts" : "○ gap")),
              h("td", { class: "num" }, d.precision),
              h("td", { class: "num" }, value(d.median)),
              h("td", { class: "num" }, value(d.p95)),
            ),
          )),
        ),
      ),
      ...(gaps.length === 0
        ? []
        : [
            h("h3", {}, "The gaps"),
            ...gaps.map((d) =>
              h("details", { class: "card" },
                h("summary", {},
                  h("span", { class: "card-title" }, d.title),
                  h("span", { class: "card-meta" }, `${d.precision} · ${d.gap?.item ?? ""}`),
                ),
                h("p", {}, h("strong", {}, "Cause: "), d.gap?.cause ?? ""),
                h("p", {}, h("strong", {}, "Next step: "), d.gap?.next ?? ""),
              ),
            ),
          ]),
    );
  }

  async function loadQueries(): Promise<void> {
    let set: QuerySet;
    try {
      const res = await fetch("data/queries.json");
      if (!res.ok) throw new Error(String(res.status));
      set = (await res.json()) as QuerySet;
    } catch {
      for (const box of [levelsBox, exactBox, complexBox, markersBox]) box.replaceChildren(h("p", { class: "empty" }, "The query set did not load."));
      return;
    }
    const commitOf = new Map(set.repos.map((r) => [r.repo, r.commit]));
    const link = (f: FunctionPlace): HTMLElement =>
      h("a", { href: sourceUrl(owner, commitOf.get(f.repo) ?? null, placeOf(f)), target: "_blank", rel: "noopener" }, `${f.repo}/${f.path}:${f.line}`);
    levelsBox.replaceChildren(
      levelTable(levelRows(set)),
      h("p", { class: "count" }, `The base is ${int(set.duplication.topNodes)} nodes: the functions outside tests of ${atlas.minNodes} nodes or more. The features of each package need Layer 2 of the catalog. The site shows them when that layer exists.`),
    );
    exactBox.replaceChildren(
      ...(set.exact.length === 0
        ? [h("p", { class: "empty" }, "No function has an exact copy.")]
        : set.exact.map((c) =>
            h("details", { class: "card" },
              h("summary", {},
                h("span", { class: "card-title" }, c.members[0]?.name ?? c.hash.slice(0, 12)),
                h("span", { class: "card-meta" }, `${c.copies} copies · ${c.nodes} nodes · ${c.repos} repos`),
              ),
              h("ul", {}, ...c.members.map((m) => h("li", {}, link(m), " ", h("code", {}, m.name)))),
            ),
          )),
    );
    // A query set of an older build has no homes
    if (set.homes !== undefined) homesBox.replaceChildren(homeCards(set.homes, link));
    complexBox.replaceChildren(complexTable(set.complex, set.limits.complexMin, link));
    markersBox.replaceChildren(markerView(markerTable(set)));
  }

  function homeCards(rows: readonly HomeCandidate[], link: (f: FunctionPlace) => HTMLElement): HTMLElement {
    if (rows.length === 0) return h("p", { class: "empty" }, "No function is outside its home.");
    return h("div", {},
      ...rows.map((row) =>
        h("details", { class: "card" },
          h("summary", {},
            h("span", { class: "card-title" }, row.title),
            h("span", { class: "card-meta" }, `${row.copies.length} copies · ${int(row.nodes)} nodes · ${row.repos.length} repos · ${row.classes} classes`),
          ),
          h("p", { class: "cell-sub" }, `Home: ${row.home.join(", ")} (${row.state})`),
          h("ul", {}, ...row.copies.map((c) => h("li", {}, link(c), " ", h("code", {}, c.name), h("span", { class: "cell-sub" }, ` ${c.nodes} nodes`)))),
        ),
      ),
    );
  }

  function levelTable(rows: readonly LevelRow[]): HTMLElement {
    const max = Math.max(0.0001, ...rows.map((r) => r.ratio));
    return h("div", { class: "scroll scroll-cue" },
      h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Level"), h("th", { class: "num" }, "Classes"), h("th", { class: "num" }, "Functions"), h("th", { class: "num" }, "Copied nodes"), h("th", { class: "num" }, "Share"))),
        h("tbody", {}, ...rows.map((r) =>
          h("tr", {},
            h("td", {}, h("strong", {}, r.level), h("div", { class: "cell-sub" }, r.title)),
            h("td", { class: "num" }, int(r.classes)),
            h("td", { class: "num" }, int(r.members)),
            h("td", { class: "num" }, int(r.duplicatedNodes)),
            h("td", { class: "num" }, h("span", { class: "ratio" }, h("span", { class: "track" }, h("span", { class: "mini", style: `width:${(r.ratio / max) * 100}%` })), pct(r.ratio))),
          ),
        )),
      ),
    );
  }

  function complexTable(rows: readonly ComplexFunction[], min: number, link: (f: FunctionPlace) => HTMLElement): HTMLElement {
    if (rows.length === 0) return h("p", { class: "empty" }, `No function has a complexity of ${min} or more.`);
    type Key = "name" | "repo" | "cyclomatic" | "depth" | "nodes";
    const cols: { key: Key; title: string }[] = [
      { key: "name", title: "Function" },
      { key: "repo", title: "Repository" },
      { key: "cyclomatic", title: "Complexity" },
      { key: "depth", title: "Depth" },
      { key: "nodes", title: "Nodes" },
    ];
    const LIMIT = 25;
    let sortKey: Key = "cyclomatic";
    let desc = true;
    let repo = "";
    let all = false;
    const repos = [...new Set(rows.map((r) => r.repo))].sort();
    const pick = h("select", { "aria-label": "All repositories" }, h("option", { value: "" }, "All repositories"), ...repos.map((r) => h("option", { value: r }, r)));
    const head = h("tr", {});
    const body = h("tbody", {});
    const count = h("p", { class: "count" });
    const more = h("button", { type: "button", class: "more" });
    pick.addEventListener("change", () => {
      repo = pick.value;
      render();
    });
    more.addEventListener("click", () => {
      all = true;
      render();
    });
    function render(): void {
      head.replaceChildren(...cols.map((c) => {
        const btn = h("button", { type: "button" }, c.title, c.key === sortKey ? (desc ? " ↓" : " ↑") : "");
        btn.addEventListener("click", () => {
          desc = c.key === sortKey ? !desc : c.key !== "name" && c.key !== "repo";
          sortKey = c.key;
          render();
        });
        return h("th", { class: c.key === "name" || c.key === "repo" ? "" : "num", "aria-sort": c.key === sortKey ? (desc ? "descending" : "ascending") : "none" }, btn);
      }));
      const list = rows.filter((r) => repo === "" || r.repo === repo).sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
        return desc ? -order : order;
      });
      const shown = all ? list : list.slice(0, LIMIT);
      body.replaceChildren(...shown.map((r) =>
        h("tr", {},
          h("td", {}, h("code", {}, r.name), h("div", { class: "cell-sub" }, link(r))),
          h("td", {}, r.repo),
          h("td", { class: "num" }, int(r.cyclomatic)),
          h("td", { class: "num" }, int(r.depth)),
          h("td", { class: "num" }, int(r.nodes)),
        ),
      ));
      count.textContent = `${shown.length} of ${list.length} functions with a complexity of ${min} or more.`;
      more.textContent = `Show all ${list.length}`;
      more.hidden = shown.length === list.length;
    }
    render();
    return h("div", {}, h("div", { class: "filters" }, pick), count, h("div", { class: "scroll scroll-cue" }, h("table", { class: "table sortable" }, h("thead", {}, head), body)), more);
  }

  function markerView(table: MarkerTable): HTMLElement {
    if (table.rows.length === 0) return h("p", { class: "empty" }, "No repository has a marker.");
    return h("div", { class: "scroll scroll-cue" },
      h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Repository"), ...table.kinds.map((k) => h("th", { class: "num" }, k)), h("th", { class: "num" }, "All"))),
        h("tbody", {}, ...table.rows.map((r) =>
          h("tr", {},
            h("td", {}, r.repo),
            ...table.kinds.map((k) => h("td", { class: "num" }, r.counts[k] === undefined ? "" : int(r.counts[k] ?? 0))),
            h("td", { class: "num" }, h("strong", {}, int(r.total))),
          ),
        )),
      ),
    );
  }

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
    return h("div", {}, h("div", { class: "scroll scroll-cue" }, svg), legend);
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
    return h("div", { class: "scroll scroll-cue" }, table);
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
