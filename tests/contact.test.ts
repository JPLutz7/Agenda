/**
 * The VAPID contact address, which is the one line of push setup that can be
 * wrong while everything else looks right.
 *
 * This file exists because of a real failure. The app shipped with a subject of
 * `mailto:agenda@localhost`. Both phones registered, the Setup screen listed
 * them, every end-to-end check passed — and no notification ever arrived,
 * because Apple answers a subject like that with 403 BadJwtToken and delivers
 * nothing. The tests missed it because the stand-in push service accepted
 * anything, and Google's real one does too.
 *
 * So the rule is asserted here, in a test that needs no browser and no
 * database, and runs on every push.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONTACT,
  contactProblem,
  pushContact,
} from "../src/lib/contact.ts";

test("the address this app actually ships with is one Apple accepts", () => {
  assert.equal(contactProblem(DEFAULT_CONTACT), null);
  assert.equal(contactProblem(pushContact()), null);
});

test("a localhost placeholder is refused — the bug this file is about", () => {
  for (const bad of [
    "mailto:agenda@localhost",
    "mailto:someone@localhost",
    "https://localhost",
    "https://localhost:3000",
    "http://agenda-nd.fly.dev", // not https
    "agenda-nd.fly.dev", // no scheme
    "mailto:not-an-address",
    "",
  ]) {
    assert.notEqual(
      contactProblem(bad),
      null,
      `"${bad}" should have been refused`,
    );
  }
});

test("the problem it reports names the address and what to do", () => {
  const problem = contactProblem("mailto:agenda@localhost");
  assert.ok(problem?.includes("mailto:agenda@localhost"));
  assert.ok(problem?.includes("AGENDA_PUBLIC_URL"));
});

test("real addresses of both shapes are accepted", () => {
  for (const good of [
    "https://agenda-nd.fly.dev",
    "https://agenda-nd.fly.dev/",
    "https://example.co.uk/contact",
    "mailto:joao@example.com",
  ]) {
    assert.equal(contactProblem(good), null, `"${good}" should be accepted`);
  }
});

test("AGENDA_PUBLIC_URL overrides the default, and blank does not", () => {
  const before = process.env.AGENDA_PUBLIC_URL;
  try {
    process.env.AGENDA_PUBLIC_URL = "https://somewhere-else.example";
    assert.equal(pushContact(), "https://somewhere-else.example");
    // An empty variable is the same as an unset one. Fly.io hands over "" for a
    // secret that was created and then cleared, and falling through to the
    // default is better than signing with nothing.
    process.env.AGENDA_PUBLIC_URL = "   ";
    assert.equal(pushContact(), DEFAULT_CONTACT);
  } finally {
    if (before === undefined) delete process.env.AGENDA_PUBLIC_URL;
    else process.env.AGENDA_PUBLIC_URL = before;
  }
});
