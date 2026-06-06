import { hash } from "bcryptjs";
import { prisma } from "../src/lib/db";

async function main() {
  const passwordHash = await hash("password123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: { email: "admin@example.com", name: "관리자", passwordHash, role: "ADMIN" },
  });
  const user = await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {},
    create: { email: "user@example.com", name: "사용자", passwordHash },
  });
  const posts: Array<[string, string, string[]]> = [
    ["RAG로 중복 질문 줄이기", "과거 게시글을 검색해서 작성 중인 글과 유사한 내용을 추천하는 방법을 정리합니다.", ["rag", "검색"]],
    ["MCP 날씨 브리핑 자동 포스팅", "외부 날씨 API를 MCP JSON-RPC 서버로 감싸 게시글 초안을 생성합니다.", ["mcp", "외부연동"]],
    ["Agent 기반 모더레이션 설계", "Function calling과 상태 제한을 사용해 게시글 보류 여부를 판단합니다.", ["agent", "운영"]],
  ];
  for (const [title, content, tags] of posts) {
    const post = await prisma.post.create({
      data: {
        title,
        content,
        summary: content.slice(0, 90),
        authorId: title.includes("MCP") ? admin.id : user.id,
      },
    });
    for (const name of tags as string[]) {
      const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
      await prisma.postTag.create({ data: { postId: post.id, tagId: tag.id } });
    }
  }
}

main().finally(() => prisma.$disconnect());
