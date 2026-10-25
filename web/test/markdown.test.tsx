import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMessage } from "../src/chat/markdown.tsx";

const html = (text: string) =>
  renderToStaticMarkup(createElement(Fragment, null, ...renderMessage(text, (u) => u === "ana")));

describe("formatação", () => {
  it("spoiler fica escondido e aceita formatação dentro", () => {
    const out = html("o final: ||**todo mundo morre**||!");
    expect(out).toContain('class="spoiler"');
    expect(out).toContain('role="button"');
    expect(out).toContain("<strong>todo mundo morre</strong>");
    expect(out.endsWith("!")).toBe(true);
  });

  it("menção com pontuação colada e texto comum continuam iguais", () => {
    expect(html("valeu @ana.")).toBe('valeu <span class="mention">@ana</span>.');
    expect(html("a || b")).toBe("a || b");
  });

  it("nunca vira HTML cru", () => {
    expect(html("||<img src=x onerror=alert(1)>||")).not.toContain("<img");
  });
});
