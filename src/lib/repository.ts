import { prisma } from "./db";
import { demoStore, isDemoStoreEnabled } from "./demo-store";

export async function findUserByEmail(email: string) {
  if (isDemoStoreEnabled()) return demoStore.findUserByEmail(email);
  return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(id: string) {
  if (isDemoStoreEnabled()) return demoStore.findUserById(id);
  return prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true } });
}

export async function createUser(input: { email: string; name: string; passwordHash: string }) {
  if (isDemoStoreEnabled()) return demoStore.createUser(input);
  return prisma.user.create({ data: input });
}

export async function listPosts(q: string, page: number, take: number) {
  if (isDemoStoreEnabled()) return demoStore.listPosts(q, page, take);
  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { content: { contains: q, mode: "insensitive" as const } },
          { tags: { some: { tag: { name: { contains: q, mode: "insensitive" as const } } } } },
        ],
      }
    : {};
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      include: {
        author: { select: { name: true } },
        tags: { include: { tag: true } },
        comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    prisma.post.count({ where }),
  ]);
  return { posts, total, page, take };
}

export async function getPost(id: string) {
  if (isDemoStoreEnabled()) return demoStore.getPost(id);
  return prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { name: true } },
      tags: { include: { tag: true } },
      comments: { include: { author: { select: { name: true } } } },
    },
  });
}

export async function allPublishedPosts() {
  if (isDemoStoreEnabled()) return demoStore.allPublishedPosts();
  return prisma.post.findMany({
    where: { status: "PUBLISHED" },
    include: { tags: { include: { tag: true } } },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function createPost(input: { title: string; content: string; summary: string; status: "PUBLISHED" | "HELD"; authorId: string }) {
  if (isDemoStoreEnabled()) return demoStore.createPost(input);
  return prisma.post.create({ data: input });
}

export async function updatePost(id: string, input: { title: string; content: string }) {
  if (isDemoStoreEnabled()) return demoStore.updatePost(id, input);
  return prisma.post.update({ where: { id }, data: input });
}

export async function deletePost(id: string) {
  if (isDemoStoreEnabled()) return demoStore.deletePost(id);
  return prisma.post.delete({ where: { id } });
}

export async function attachPostTags(postId: string, tags: string[]) {
  if (isDemoStoreEnabled()) return demoStore.attachTags(postId, tags);
  await prisma.postTag.deleteMany({ where: { postId } });
  for (const name of tags) {
    const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
    await prisma.postTag.create({ data: { postId, tagId: tag.id } });
  }
}

export async function addComment(input: { postId: string; authorId: string; content: string }) {
  if (isDemoStoreEnabled()) return demoStore.addComment(input);
  return prisma.comment.create({ data: input });
}
