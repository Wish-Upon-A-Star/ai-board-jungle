import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return fail("입력값을 확인하세요.", 422, error.flatten());
  }
  console.error(error);
  return fail("서버 처리 중 오류가 발생했습니다.", 500);
}
