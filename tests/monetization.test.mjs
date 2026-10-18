// Static checks for the monetization spot (step 1 of the money plan).
// Run with: npm test
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const js = readFileSync(join(root, "app.js"), "utf8");
const css = readFileSync(join(root, "style.css"), "utf8");

// Recommendation panel exists, hidden until a test completes
assert.match(html, /id="fixPanel"/, "index.html must contain the fix panel");
assert.match(html, /id="fixText"/, "fix panel must have a text slot");
assert.match(html, /id="fixLink"/, "fix panel must have a link slot for the affiliate URL");

// Honest affiliate disclosure is visible to visitors
assert.match(html, /may earn a commission/i, "affiliate disclosure must be on the page");

// Privacy policy page (required before applying for AdSense)
assert.ok(existsSync(join(root, "privacy.html")), "privacy.html must exist");
assert.match(html, /href="privacy\.html"/, "homepage must link to the privacy policy");

// Affiliate link is config-driven, never hard-coded into markup
assert.match(js, /const AFFILIATE/, "app.js must define an AFFILIATE config");
assert.match(js, /function tipFor\(/, "app.js must pick a tip from the results");
assert.match(js, /fixPanel/, "app.js must show/hide the fix panel");
assert.doesNotMatch(html, /amazon\.com|amzn\.to/i, "no placeholder affiliate link in HTML");

// Panel is styled consistently with the rest of the site
assert.match(css, /\.fix-panel/, "style.css must style the fix panel");

console.log("monetization.test.mjs: all checks passed");
