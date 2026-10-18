import pkg from "../package.json" with { type: "json" };

/** The app's version (package.json), compared with the latest GitHub release by the updater. */
export const VERSION: string = pkg.version;

/** Where releases are published: the updater and the website's download page read the latest one. */
export const RELEASE_REPO = "sucsage/agentic-wallet";
export const TAG_PREFIX = "desktop-v";
