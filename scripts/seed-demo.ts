import { hash } from "bcryptjs";
import { demoStore } from "../src/lib/demo-store";

async function main() {
  await demoStore.reset();
  const passwordHash = await hash("password123", 10);
  await demoStore.ensureDemoUsers(passwordHash);
  const admin = await demoStore.findUserByEmail("admin@example.com");
  const user = await demoStore.findUserByEmail("user@example.com");
  if (!admin || !user) throw new Error("demo users were not created");

  const samples = [
    {
      title: "RAG로 중복 질문 줄이기",
      content: "과거 게시글을 검색해서 작성 중인 글과 유사한 내용을 추천하는 방법을 정리합니다.",
      tags: ["rag", "검색"],
      authorId: user.id,
    },
    {
      title: "MCP 날씨 브리핑 자동 포스팅",
      content: "외부 날씨 API를 MCP JSON-RPC 서버로 감싸 게시글 초안을 생성합니다.",
      tags: ["mcp", "외부연동"],
      authorId: admin.id,
    },
    {
      title: "Agent 기반 모더레이션 설계",
      content: "Function calling과 상태 제한을 사용해 게시글 보류 여부를 판단합니다.",
      tags: ["agent", "운영"],
      authorId: user.id,
    },
  ];

  for (const sample of samples) {
    const post = await demoStore.createPost({
      title: sample.title,
      content: sample.content,
      summary: sample.content,
      status: "PUBLISHED",
      authorId: sample.authorId,
    });
    await demoStore.attachTags(post.id, sample.tags);
  }
  console.log("Demo DB seeded: admin@example.com / password123");
}

main();
