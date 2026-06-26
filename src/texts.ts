import fs from "fs";
import path from "path";

const TEXTS_DIR = path.join(process.cwd(), "texts");
let dict: Record<string, string> = {};

export function reloadTexts(): void {
  try {
    dict = JSON.parse(fs.readFileSync(path.join(TEXTS_DIR, "pt.json"), "utf-8"));
  } catch (err) {
    console.error("[texts] could not load pt.json:", err);
    dict = {};
  }
}

reloadTexts();

export function tServer(key: string, vars?: Record<string, string | number>): string {
  let text = dict[key] || key;
  if (vars) {
    for (const k in vars) text = text.split("{" + k + "}").join(String(vars[k]));
  }
  return text;
}

export function textsScript(): string {
  return "window.HUB_TEXTS=" + JSON.stringify(dict) + ";";
}
