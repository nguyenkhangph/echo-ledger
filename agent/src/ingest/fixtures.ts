import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { IngestedPost, type IngestedPost as IngestedPostType } from "./types";

async function readJsonl(path: string): Promise<IngestedPostType[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const contents = await file.text();
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return IngestedPost.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid fixture ${path}:${index + 1}`, { cause: error });
      }
    });
}

function sortedUnique(posts: readonly IngestedPostType[]): IngestedPostType[] {
  const byKey = new Map(posts.map((post) => [`${post.platform}:${post.url}`, post]));
  return [...byKey.values()].sort(
    (left, right) => left.posted_at.localeCompare(right.posted_at) || left.url.localeCompare(right.url),
  );
}

export async function writePostFixtures(
  directory: string,
  posts: readonly IngestedPostType[],
): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const byDate = new Map<string, IngestedPostType[]>();
  for (const post of posts) {
    const date = post.posted_at.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), IngestedPost.parse(post)]);
  }

  const written: string[] = [];
  for (const [date, datedPosts] of [...byDate].sort(([left], [right]) => left.localeCompare(right))) {
    const path = join(directory, `${date}.jsonl`);
    const merged = sortedUnique([...(await readJsonl(path)), ...datedPosts]);
    const temporaryPath = `${path}.tmp`;
    await Bun.write(temporaryPath, `${merged.map((post) => JSON.stringify(post)).join("\n")}\n`);
    await rename(temporaryPath, path);
    written.push(path);
  }
  return written;
}

export async function replayPostFixtures(directory: string, date?: string): Promise<IngestedPostType[]> {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid fixture date: ${date}`);
  }

  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const selected = names
    .filter((name) => name.endsWith(".jsonl") && (!date || name === `${date}.jsonl`))
    .sort();
  const posts: IngestedPostType[] = [];
  for (const name of selected) posts.push(...(await readJsonl(join(directory, name))));
  return posts;
}