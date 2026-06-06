const port = process.env.CDP_PORT || "9223";
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve) => {
        const requestId = ++id;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.call("Target.createTarget", { url: appUrl });
  await wait(2500);

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.url.includes("127.0.0.1:3000"));
  if (!target) throw new Error("UI target was not created");

  const page = await connect(target.webSocketDebuggerUrl);
  await page.call("Runtime.enable");

  const evalJs = async (expression) => {
    const result = await page.call("Runtime.evaluate", { expression, returnByValue: true });
    return result.result.result.value;
  };
  const bodyText = () => evalJs("document.body.innerText");

  let text = await bodyText();
  const alreadyLoggedIn = text.includes("사용자별 자동화 작업") && text.includes("자동화 등록");
  if (!alreadyLoggedIn && (!text.includes("회원가입") || !text.includes("일반 사용자 데모"))) {
    throw new Error("login/register controls are missing");
  }

  if (!alreadyLoggedIn) {
    await page.call("Runtime.evaluate", {
      expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('관리자 데모')).click()",
    });
    await wait(2000);
  }

  text = await bodyText();
  const required = [
    "사용자별 자동화 작업",
    "GitHub",
    "Notion",
    "자동화 등록",
    "AI 모델",
    "프로필 기본값",
    "프로필 불러오기",
    "현재 설정 프로필 저장",
    "템플릿 선택",
    "커스텀 모델/API",
    "커스텀 연결 칸",
    "연결 칸 추가",
    "커스텀 출력 템플릿",
    "GitHub Repo URL",
    "Notion DB URL",
    "API Key 관리",
    "GitHub 이슈 템플릿",
    "Notion 반영 템플릿",
    "API 실행 콘솔",
    "게시판 공유 이력",
    "Redis",
    "PostgreSQL",
  ];
  const missing = required.filter((item) => !text.includes(item));

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('연결 칸 추가')).click()",
  });
  await wait(500);
  const afterAddConnection = await bodyText();
  const customConnectionAdded = afterAddConnection.includes("새 연결 3") || afterAddConnection.includes("새 연결");

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('현재 설정 프로필 저장')).click()",
  });
  await wait(900);
  const afterProfileSave = await bodyText();
  const profileSaved = afterProfileSave.includes("profile.save") || afterProfileSave.includes("profileSettings");

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('Health')).click()",
  });
  await wait(900);
  const afterHealth = await bodyText();
  const healthOk = afterHealth.includes("React + FastAPI + PostgreSQL + Redis");

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('MCP')).click()",
  });
  await wait(900);
  const afterMcp = await bodyText();
  const mcpOk = afterMcp.includes("자동화 작업의 주기");

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('Agent Hub')).click()",
  });
  await wait(900);
  const afterHub = await bodyText();
  const hubOk = afterHub.includes("google_calendar") && afterHub.includes("figma");

  await page.call("Runtime.evaluate", {
    expression: "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '실행').click()",
  });
  await wait(1000);
  const afterRun = await bodyText();
  const ran = afterRun.includes("loopGuard") || afterRun.includes("SyncPlannerAgent");

  page.close();
  browser.close();

  const result = { missing, customConnectionAdded, profileSaved, healthOk, mcpOk, hubOk, ran, sample: text.slice(0, 1200) };
  console.log(JSON.stringify(result, null, 2));
  if (missing.length || !customConnectionAdded || !profileSaved || !healthOk || !mcpOk || !hubOk || !ran) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
