import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { parseImport } from "./importFile";

describe("parseCsv", () => {
  it("splits plain fields and rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps commas, newlines and escaped quotes inside quoted fields", () => {
    const csv = 'jd,company_url,days\r\n"Engineer, backend\nMust know ""Go""",acme.com,5\r\n';
    expect(parseCsv(csv)).toEqual([["jd", "company_url", "days"], ['Engineer, backend\nMust know "Go"', "acme.com", "5"]]);
  });

  it("handles empty fields, a missing trailing newline and a BOM", () => {
    expect(parseCsv("﻿a,,c\n,x,")).toEqual([["a", "", "c"], ["", "x", ""]]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"open\n')).toThrow(/closing quote/);
  });
});

describe("parseImport", () => {
  it("reads CSV rows by header name and defaults days to 7", () => {
    const drafts = parseImport("roles.csv", 'company_url,jd\nacme.com,"Line 1\nLine 2"\n');
    expect(drafts).toEqual([{ jd: "Line 1\nLine 2", company_url: "acme.com", days: "7" }]);
  });

  it("reads the grader's JSON case shape", () => {
    const drafts = parseImport("cases.json", JSON.stringify([{ id: "x", jd: "JD", company_url: "https://a.io", days: 3 }]));
    expect(drafts).toEqual([{ jd: "JD", company_url: "https://a.io", days: "3" }]);
  });

  it("rejects more than 10 roles and unknown file types", () => {
    expect(() => parseImport("a.json", JSON.stringify(Array(11).fill({ jd: "a", company_url: "b" })))).toThrow(/limit is 10/);
    expect(() => parseImport("a.txt", "")).toThrow(/\.json or \.csv/);
  });
});
