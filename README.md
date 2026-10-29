# codeatlas

codeatlas finds the code that many repositories write again and again. It writes a duplication atlas: a data file of each copy, with its size, its repositories and its topic.

## What it measures

- **Function shapes.** For each function, the atlas keeps the sequence of its syntax node types, without names, literal values and types. Two functions with one shape differ only in their identifiers, their literals or their types. Thus a helper that two repositories wrote on their own gets one hash, also when one copy is JavaScript and the other is TypeScript.
- **Clone classes.** A clone class is a set of two or more functions with one shape and 40 nodes or more. Its duplicated nodes are its size times its copies minus one: the code that one shared function removes. A class inside a bigger class does not count again.
- **Shared names.** Each exported name that two or more repositories declare.
- **Packages by purpose.** For each purpose, for example seeded random or schemas, the atlas lists the packages that each repository imports. Two packages for one purpose show a split.
- **Topics.** The words of the names and the paths put each class into an area of the shared rigor libraries. The areas are generators, statistics, gates, test generation, chaos and load, and measures.

The output is sorted, so one input gives one byte sequence.

## Use

```sh
node packages/atlas/src/cli.ts build --repos-dir <folder> --out atlas.json --markdown atlas.md
node packages/atlas/src/cli.ts build template=../template packing=../packing --min-nodes 60
```

The scan reads the files that git keeps, so build output and `node_modules` stay out.

## CI

The workflow `Atlas` (`.github/workflows/atlas.yml`) clones each public repository of the owner every Monday, and on a manual start. It writes the atlas as an artifact of the run and as the summary of the run.
