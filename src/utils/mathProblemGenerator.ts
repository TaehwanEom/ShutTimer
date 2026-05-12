// 알람 종료 미션용 간단 산수 문제 생성기.
// 한 자릿수 + 한 자릿수 (= 일부 두 자릿수 + 한 자릿수) 사칙연산. 답은 항상 정수.

export type MathOperator = '+' | '-' | '×' | '÷';

export type MathProblem = {
  a: number;
  b: number;
  op: MathOperator;
  answer: number;
  display: string;
};

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateAddition(): MathProblem {
  // 한 자릿수 + 한 자릿수 ~ 두 자릿수 + 한 자릿수.
  const a = rand(2, 19);
  const b = rand(2, 9);
  return { a, b, op: '+', answer: a + b, display: `${a} + ${b}` };
}

function generateSubtraction(): MathProblem {
  // 결과 음수 회피 (= a >= b 강제).
  const a = rand(5, 19);
  const b = rand(1, Math.min(a - 1, 9));
  return { a, b, op: '-', answer: a - b, display: `${a} - ${b}` };
}

function generateMultiplication(): MathProblem {
  // 두 자릿수 × 한 자릿수 (= 24 × 6 같은 영역). 양쪽 두 자릿수 영역 = 너무 어려움 회피.
  const a = rand(2, 19);
  const b = rand(2, 9);
  return { a, b, op: '×', answer: a * b, display: `${a} × ${b}` };
}

function generateDivision(): MathProblem {
  // 답이 정수 강제 = b × answer = a 형태로 역산.
  const b = rand(2, 9);
  const answer = rand(2, 9);
  const a = b * answer;
  return { a, b, op: '÷', answer, display: `${a} ÷ ${b}` };
}

/** 사칙연산 중 랜덤 1개 출제. 답은 항상 0 이상 정수. */
export function generateMathProblem(): MathProblem {
  const generators = [generateAddition, generateSubtraction, generateMultiplication, generateDivision];
  const pick = generators[rand(0, generators.length - 1)];
  return pick();
}
