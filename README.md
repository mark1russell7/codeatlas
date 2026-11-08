# codeatlas

codeatlas finds the code that many repositories write again and again. It writes a duplication atlas: a data file of each copy, with its size, its repositories and its topic.

## What it measures

- **Function shapes.** For each function, the atlas keeps the sequence of its syntax node types, without names, literal values and types. Two functions with one shape differ only in their identifiers, their literals or their types. Thus a helper that two repositories wrote on their own gets one hash, also when one copy is JavaScript and the other is TypeScript.
- **Clone classes.** A clone class is a set of two or more functions with one shape and 40 nodes or more. Its duplicated nodes are its size times its copies minus one: the code that one shared function removes. A class inside a bigger class does not count again.
- **Shared names.** Each exported name that two or more repositories declare.
- **Packages by purpose.** For each purpose, for example seeded random or schemas, the atlas lists the packages that each repository imports. Two packages for one purpose show a split.
- **Corpus.** For each repository, the corpus counts the files, the lines and the bytes of each kind of file. Examples of kinds are source, tests, lockfiles and prose. The corpus is the base of each cost estimate.
- **Facts (Layer 1a).** For each git blob, the scan gives the symbols, the imports, the exports, the call sites and the debt markers. It also gives three clone hashes of each function: exact, renamed and shape. The key of the facts is the blob id, so a rescan with `--cache` parses only new blobs. [docs/SCHEMA.md](docs/SCHEMA.md) gives the schema.
- **Catalog.** The command `catalog` writes the facts into one SQLite database, through `node:sqlite`. The workflow `Catalog` builds it each week over the public repositories, and keeps it as the cache of the next run.
- **Topics.** The words of the names and the paths put each class into an area of the shared rigor libraries. The areas are generators, statistics, gates, test generation, chaos and load, and measures.

The output is sorted, so one input gives one byte sequence.

## Use

```sh
node packages/atlas/src/cli.ts build --repos-dir <folder> --out atlas.json --markdown atlas.md
node packages/atlas/src/cli.ts build template=../template packing=../packing --min-nodes 60
node packages/atlas/src/cli.ts corpus --repos-dir <folder> --out corpus.json --markdown corpus.md
node packages/atlas/src/cli.ts catalog --repos-dir <folder> --out catalog.sqlite --markdown catalog.md
node packages/atlas/src/cli.ts trend --db catalog.sqlite [--previous trend.json] --out trend.json
node packages/atlas/src/cli.ts queries --db catalog.sqlite --out queries.json
node packages/atlas/src/cli.ts facts --repos-dir <folder> --out facts.jsonl --markdown facts.md [--cache <facts.jsonl>]
node packages/atlas/src/cli.ts clone --owner <owner> --into <folder>
node packages/site/src/build.ts --atlas atlas.json --out site
```

The scan reads the files that git keeps, so build output and `node_modules` stay out.

## The site

The site at https://mark1russell7.github.io/codeatlas/ shows the newest atlas. It shows the topics, the repositories that share code, and each clone class with a link to each copy. The atlas data is at `data/atlas.json`, and the corpus is at `data/corpus.json`.

The site also shows the answers of the query set of the catalog. These are the copies at each level, the exact copies, the complex functions and the markers. Each function links to its line at the commit of the scan. These answers are at `data/queries.json`. The trend of each build is at `data/trend.json`.

## CI

The workflow `Pages` (`.github/workflows/pages.yml`) clones each public repository of the owner every Monday, on each push to main and on a manual start. It builds the atlas and the site, and publishes them to GitHub Pages.
