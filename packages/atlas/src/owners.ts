/**
 * The owners of the repositories that the atlas reads: the GitHub accounts that hold them. A repository can move from
 * one owner to the other, so each reader of the atlas reads each owner. No reader names an owner in its code.
 *
 * The home of the list is `@mark1russell7/conventions/owners` (template #393). That release is not on npm yet, so this
 * module is a copy. The copy ends when the installed conventions exports `./owners`. Then an import of the home
 * replaces the copy. A test fails when the installed conventions exports `./owners` and the copy is still here.
 */

/** A GitHub account that holds repositories. The fields are a part of `Owner` of `@mark1russell7/conventions/owners`. */
export interface Owner {
  /** The login of the account. */
  readonly login: string;
  /** The kind of the account. */
  readonly kind: "user" | "organization";
}

/** The owners, the personal account first. A copy of `OWNERS` of `@mark1russell7/conventions/owners`. */
export const OWNERS: readonly Owner[] = [
  { login: "mark1russell7", kind: "user" },
  { login: "metrograph-labs", kind: "organization" },
];

/** The logins of the owners, in the order of `OWNERS`. */
export const LOGINS: readonly string[] = OWNERS.map((owner) => owner.login);

/**
 * This function gives each repository name that more than one owner has, in lower case and in order. The catalog keys
 * each repository by its name, so a reader stops on such a name. A copy of `sharedNames` of the home.
 */
export function sharedNames(repos: readonly { readonly owner: string; readonly name: string }[]): string[] {
  const owners = new Map<string, Set<string>>();
  for (const repo of repos) {
    const name = repo.name.toLowerCase();
    owners.set(name, (owners.get(name) ?? new Set<string>()).add(repo.owner.toLowerCase()));
  }
  return [...owners]
    .filter(([, logins]) => logins.size > 1)
    .map(([name]) => name)
    .sort();
}
