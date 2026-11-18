import { describe, expect, it } from "vitest";
import {
  deviceOf,
  externalReferrerHost,
  isBotUserAgent,
  normalizeTrackedPath,
  postSlugOfPath,
  visitorIdFromCookie,
} from "./analytics";

const VISITOR = "5f0c8f4e-1f0a-4c4e-9a63-0f4f2b5d9c11";

describe("normalizeTrackedPath", () => {
  it("drops the query and the trailing slash", () => {
    expect(normalizeTrackedPath("/posts/?page=2")).toBe("/posts");
    expect(normalizeTrackedPath("/post/alpha")).toBe("/post/alpha");
    expect(normalizeTrackedPath("/")).toBe("/");
  });

  it("refuses anything that is not a public page", () => {
    expect(normalizeTrackedPath("/admin")).toBeNull();
    expect(normalizeTrackedPath("/admin/posts")).toBeNull();
    expect(normalizeTrackedPath("/api/track")).toBeNull();
    expect(normalizeTrackedPath("/login")).toBeNull();
    expect(normalizeTrackedPath("")).toBeNull();
    expect(normalizeTrackedPath(null)).toBeNull();
    expect(normalizeTrackedPath(42)).toBeNull();
  });
});

describe("visitorIdFromCookie", () => {
  it("reads the anonymous uuid out of the Cookie header", () => {
    expect(visitorIdFromCookie(`other=1; pv_id=${VISITOR}; more=2`)).toBe(
      VISITOR,
    );
  });

  it("ignores a missing or malformed value", () => {
    expect(visitorIdFromCookie(null)).toBeNull();
    expect(visitorIdFromCookie("pv_id=not-a-uuid")).toBeNull();
    expect(visitorIdFromCookie("session=abc")).toBeNull();
  });
});

describe("externalReferrerHost", () => {
  it("keeps another site's host", () => {
    expect(
      externalReferrerHost(
        "https://news.ycombinator.com/item?id=1",
        "blog.ssure.net",
      ),
    ).toBe("news.ycombinator.com");
  });

  it("ignores the site itself and unusable values", () => {
    expect(
      externalReferrerHost("https://blog.ssure.net/posts", "blog.ssure.net"),
    ).toBeNull();
    expect(externalReferrerHost("", "blog.ssure.net")).toBeNull();
    expect(externalReferrerHost("not a url", "blog.ssure.net")).toBeNull();
  });
});

describe("deviceOf", () => {
  it("reads the device from the User-Agent", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile")).toBe(
      "mobile",
    );
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
      "desktop",
    );
  });
});

describe("isBotUserAgent", () => {
  it("drops crawlers and missing agents", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(
      true,
    );
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      false,
    );
  });
});

describe("postSlugOfPath", () => {
  it("only names a slug for a Post page", () => {
    expect(postSlugOfPath("/post/alpha")).toBe("alpha");
    expect(postSlugOfPath("/posts")).toBeNull();
  });
});
