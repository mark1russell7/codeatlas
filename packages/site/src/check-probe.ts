/**
 * The probe of the home page. The site check of the Pages workflow starts it in a browser at each width, before the
 * deploy. A failed check stops the deploy.
 *
 * The probe drives the atlas. The page loads the data. The search and a topic filter the classes. A row of the table
 * picks a repository. The button "Clear" gives the full list again.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => Element | null;
declare const $$: (selector: string) => Element[];
declare const type: (target: string | Element, text: string) => void;
declare const click: (target: string | Element) => void;

/** The atlas is one large file, so a slow runner gets a large margin. */
const LOAD_MS = 20000;

const text = (selector: string): string => $(selector)?.textContent ?? "";
/** This function gives the count of the classes in the line above the list of the section of the classes. */
const classes = (): number => Number(/^([\d,]+) classes/.exec(text("#classes .count"))?.[1]?.replaceAll(",", "") ?? "-1");
const value = (selector: string): string => ($(selector) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";

// The page loads the atlas and draws the classes.
check("the page loads the atlas", await until(() => $$("#classes .card").length > 0, LOAD_MS), text("#app").slice(0, 200));
const all = classes();
check("the page counts the classes", all > 0, text("#classes .count"));
check("the page shows the totals", $$(".kpis > *").length >= 3, $$(".kpis > *").length);
check("the page has the topics", $$(".bar-row").length > 0, $$(".bar-row").length);
check("the page shows the first 60 classes, and a button for more", $$("#classes .card").length === 60 && $("#classes .more") !== null, $$("#classes .card").length);

// The button gives more classes.
click("#classes .more");
check("the button gives more classes", await until(() => $$("#classes .card").length > 60), $$("#classes .card").length);

// The search finds a class by its name.
const name = $$("#classes .card-title")
  .map((title) => title.textContent ?? "")
  .find((title) => !title.startsWith("<"));
check("a class has a name", name !== undefined);
type("#f-query", name ?? "");
check("the search makes the list shorter", await until(() => classes() > 0 && classes() < all), text("#classes .count"));
check("the search keeps the class of the name", $$("#classes .card-title").some((title) => title.textContent === name), name);

// The button "Clear" gives the full list.
click(".reset");
check("the button Clear gives the full list", await until(() => classes() === all), text("#classes .count"));
check("the button Clear empties the search", value("#f-query") === "", value("#f-query"));

// A topic filters the list, and the control shows the topic.
const topic = text(".bar-row .bar-label");
click(".bar-row");
check("a topic sets its filter", await until(() => value("#f-topic") === topic), value("#f-topic"));
check("a topic makes the list shorter", await until(() => classes() > 0 && classes() < all), text("#classes .count"));
click(".reset");
await until(() => classes() === all);

// A row of the table picks a repository.
click('tr[tabindex="0"]');
check("a row of the table picks its repository", await until(() => value("#f-repo") !== ""), value("#f-repo"));
check("the repository gives a list", await until(() => classes() >= 0 && classes() < all), text("#classes .count"));

// A card opens and names its copies.
const card = $("#classes .card") as HTMLDetailsElement | null;
click("#classes .card summary");
check("a card opens", await until(() => card?.open === true));
check("a card names each copy", (card?.querySelectorAll("ul li").length ?? 0) >= 2, card?.querySelectorAll("ul li").length);

export {};
