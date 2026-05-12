// 알람 종료 미션 = 받아쓰기 문제 생성기. 3문제 순차 출제 (= AlarmTypingMode 측).
// 각 문제 = 한글 단어 / 영문 단어 / 6~8자리 무작위 숫자 중 1개. 본 앱 언어 = ko 시 한글 풀 포함.

export type TypingProblemKind = 'ko' | 'en' | 'number';

export type TypingProblem = {
  kind: TypingProblemKind;
  text: string;
};

const KO_WORDS: string[] = [
  '안녕하세요', '일어나세요', '굿모닝', '좋은 아침', '정신 차리세요',
  '스트레칭', '물 한잔', '샤워하러 가요', '오늘도 화이팅', '잠 깨세요',
  '활기찬 하루', '새로운 시작', '산뜻한 아침', '양치하러 가요', '세수하세요',
  '아침밥 먹어요', '운동하러 가요', '명상의 시간', '심호흡하세요', '미소 지어요',
  '감사합니다', '새벽 공기', '따뜻한 햇살', '모닝 커피', '따뜻한 차',
  '산책하러 가요', '뉴스 보세요', '일정 확인', '옷 갈아입어요', '머리 감으세요',
  '알람 꺼주세요', '정신 차리자', '일찍 일어났어요', '새 출발이에요', '오늘도 파이팅',
  '즐거운 하루', '좋은 하루 되세요', '행복한 하루', '평화로운 아침', '희망찬 하루',
  '도전하는 하루', '성공의 시작', '노력하는 하루', '꿈을 향해', '자신감 가득',
  '감사한 하루', '활짝 웃어요', '힘내세요', '파이팅', '오늘도 수고',
];

const EN_WORDS: string[] = [
  'wake up', 'good morning', 'rise and shine', 'new day', 'fresh start',
  'stay focused', 'stretch now', 'drink water', 'lets go', 'hello',
  'brand new day', 'seize the day', 'morning routine', 'coffee time', 'tea time',
  'cold shower', 'brush teeth', 'wash face', 'breakfast time', 'exercise now',
  'meditation', 'deep breath', 'smile bright', 'thank you', 'dawn light',
  'sunshine', 'warm coffee', 'morning walk', 'read news', 'check schedule',
  'get dressed', 'wash hair', 'turn off alarm', 'wake yourself', 'early bird',
  'fresh morning', 'happy day', 'lovely day', 'peaceful morning', 'hopeful day',
  'brave heart', 'take chances', 'you can do it', 'work hard', 'dream big',
  'be confident', 'grateful day', 'keep smiling', 'stay strong', 'never give up',
];

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateNumberProblem(): TypingProblem {
  // 6~8자리 무작위 숫자. 첫 자리는 0 아님 강제.
  const len = rand(6, 8);
  let text = String(rand(1, 9));
  for (let i = 1; i < len; i++) {
    text += String(rand(0, 9));
  }
  return { kind: 'number', text };
}

function generateKoreanProblem(): TypingProblem {
  return { kind: 'ko', text: pickFrom(KO_WORDS) };
}

function generateEnglishProblem(): TypingProblem {
  return { kind: 'en', text: pickFrom(EN_WORDS) };
}

/**
 * 본 앱 언어 = locale 측 정합. 'ko' 시 = 한글/영문/숫자 모두 사용. 그 외 = 영문/숫자만.
 * 중복 종류 없이 3문제 출제 시도 (= 풀이 부족하면 중복 허용).
 */
export function generateTypingProblems(locale: string, count: number = 3): TypingProblem[] {
  const allowKorean = locale.startsWith('ko');
  const kinds: TypingProblemKind[] = allowKorean ? ['ko', 'en', 'number'] : ['en', 'number'];

  const problems: TypingProblem[] = [];
  const usedTexts = new Set<string>();
  for (let i = 0; i < count; i++) {
    const kind = pickFrom(kinds);
    let problem: TypingProblem;
    let attempts = 0;
    do {
      problem = kind === 'ko' ? generateKoreanProblem()
        : kind === 'en' ? generateEnglishProblem()
          : generateNumberProblem();
      attempts++;
    } while (usedTexts.has(problem.text) && attempts < 5);
    usedTexts.add(problem.text);
    problems.push(problem);
  }
  return problems;
}

/** 입력 정답 체크. 공백/대소문자 무시. 한글은 띄어쓰기 무시 후 정확 일치. */
export function checkTypingAnswer(input: string, problem: TypingProblem): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return normalize(input) === normalize(problem.text);
}
