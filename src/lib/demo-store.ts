import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type DemoUser = { id: string; email: string; name: string; passwordHash: string; role: "USER" | "ADMIN"; createdAt: string };
export type DemoTag = { id: string; name: string };
export type DemoComment = { id: string; content: string; postId: string; authorId: string; createdAt: string };
export type DemoPost = {
  id: string;
  title: string;
  content: string;
  summary: string;
  status: "PUBLISHED" | "HELD";
  authorId: string;
  createdAt: string;
  updatedAt: string;
};

type DemoDb = {
  users: DemoUser[];
  posts: DemoPost[];
  comments: DemoComment[];
  tags: DemoTag[];
  postTags: Array<{ postId: string; tagId: string }>;
};

const file = join(process.cwd(), "data", "demo-db.json");
const enabled = process.env.AI_BOARD_DEMO_MODE === "1" || !process.env.DATABASE_URL;

const initial: DemoDb = {
  users: [],
  posts: [],
  comments: [],
  tags: [],
  postTags: [],
};

export function isDemoStoreEnabled() {
  return enabled;
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

async function load(): Promise<DemoDb> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as DemoDb;
  } catch {
    return structuredClone(initial);
  }
}

async function save(db: DemoDb) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(db, null, 2), "utf-8");
}

function expandPost(db: DemoDb, post: DemoPost) {
  const author = db.users.find((user) => user.id === post.authorId);
  const tagIds = db.postTags.filter((item) => item.postId === post.id).map((item) => item.tagId);
  const tags = db.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => ({ tag }));
  const comments = db.comments
    .filter((comment) => comment.postId === post.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => ({
      ...comment,
      author: { name: db.users.find((user) => user.id === comment.authorId)?.name || "알 수 없음" },
    }));
  return { ...post, author: { name: author?.name || "알 수 없음" }, tags, comments };
}

export const demoStore = {
  async reset() {
    await save(structuredClone(initial));
  },

  async findUserByEmail(email: string) {
    const db = await load();
    return db.users.find((user) => user.email === email) || null;
  },

  async findUserById(idValue: string) {
    const db = await load();
    const user = db.users.find((item) => item.id === idValue);
    return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
  },

  async createUser(input: { email: string; name: string; passwordHash: string; role?: "USER" | "ADMIN" }) {
    const db = await load();
    const user: DemoUser = {
      id: id("usr"),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role || "USER",
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    await save(db);
    return user;
  },

  async ensureDemoUsers(passwordHash: string) {
    const db = await load();
    if (!db.users.some((user) => user.email === "admin@example.com")) {
      db.users.push({
        id: id("usr"),
        email: "admin@example.com",
        name: "관리자",
        passwordHash,
        role: "ADMIN",
        createdAt: new Date().toISOString(),
      });
    }
    if (!db.users.some((user) => user.email === "user@example.com")) {
      db.users.push({
        id: id("usr"),
        email: "user@example.com",
        name: "사용자",
        passwordHash,
        role: "USER",
        createdAt: new Date().toISOString(),
      });
    }
    await save(db);
  },

  async listPosts(q = "", page = 1, take = 6) {
    const db = await load();
    const query = q.trim().toLowerCase();
    let posts = db.posts.map((post) => expandPost(db, post));
    if (query) {
      posts = posts.filter((post) => {
        const text = `${post.title} ${post.content} ${post.tags.map((item) => item.tag.name).join(" ")}`.toLowerCase();
        return text.includes(query);
      });
    }
    posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { posts: posts.slice((page - 1) * take, page * take), total: posts.length, page, take };
  },

  async allPublishedPosts() {
    const db = await load();
    return db.posts.filter((post) => post.status === "PUBLISHED").map((post) => expandPost(db, post));
  },

  async getPost(postId: string) {
    const db = await load();
    const post = db.posts.find((item) => item.id === postId);
    return post ? expandPost(db, post) : null;
  },

  async createPost(input: { title: string; content: string; summary: string; status: "PUBLISHED" | "HELD"; authorId: string }) {
    const db = await load();
    const now = new Date().toISOString();
    const post: DemoPost = { id: id("post"), ...input, createdAt: now, updatedAt: now };
    db.posts.push(post);
    await save(db);
    return post;
  },

  async updatePost(postId: string, input: { title: string; content: string }) {
    const db = await load();
    const post = db.posts.find((item) => item.id === postId);
    if (!post) return null;
    post.title = input.title;
    post.content = input.content;
    post.updatedAt = new Date().toISOString();
    await save(db);
    return post;
  },

  async deletePost(postId: string) {
    const db = await load();
    db.posts = db.posts.filter((post) => post.id !== postId);
    db.comments = db.comments.filter((comment) => comment.postId !== postId);
    db.postTags = db.postTags.filter((item) => item.postId !== postId);
    await save(db);
  },

  async attachTags(postId: string, names: string[]) {
    const db = await load();
    db.postTags = db.postTags.filter((item) => item.postId !== postId);
    for (const name of names) {
      let tag = db.tags.find((item) => item.name === name);
      if (!tag) {
        tag = { id: id("tag"), name };
        db.tags.push(tag);
      }
      db.postTags.push({ postId, tagId: tag.id });
    }
    await save(db);
  },

  async addComment(input: { postId: string; authorId: string; content: string }) {
    const db = await load();
    const comment: DemoComment = { id: id("com"), ...input, createdAt: new Date().toISOString() };
    db.comments.push(comment);
    await save(db);
    return comment;
  },
};
