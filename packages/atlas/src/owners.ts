/**
 * The owners of the repositories that the atlas reads: the GitHub accounts that hold them. A repository can move from
 * one owner to the other, so each reader of the atlas reads each owner. No reader names an owner in its code.
 *
 * The home of the list is `@mark1russell7/conventions/owners`. This module gives the list of the home to the atlas.
 */
import { OWNERS } from "@mark1russell7/conventions/owners";

export { OWNERS, sharedNames, type Owner } from "@mark1russell7/conventions/owners";

/** The logins of the owners, in the order of `OWNERS`. */
export const LOGINS: readonly string[] = OWNERS.map((owner) => owner.login);
