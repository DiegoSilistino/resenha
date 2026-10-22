import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId } from "../src/youtube.ts";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeVideoId", () => {
  it.each([
    [ID],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`http://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}&si=abc`],
    [`https://youtu.be/${ID}?t=10`],
    [`youtu.be/${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])("aceita %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID);
  });

  it.each([
    [""],
    ["não é link"],
    ["https://www.youtube.com/playlist?list=PL123"],
    ["https://evil.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=curto"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>"],
    ["javascript:alert(1)"],
    ["https://vimeo.com/123456"],
  ])("rejeita %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});
