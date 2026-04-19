// @v1.5 — 실내/일상 미션 풀 (30개)
// 기준: 집·사무실에서 1분 내 찾을 수 있는 사물만. 야생동물·교통·야외스포츠·도로시설·가공음식 제외.
// 각 미션 = PNG 1개 + COCO 라벨 배열(대부분 단일, 혼동 쌍만 그룹)+ 한글 라벨 1개
// Microsoft Fluent Emoji (MIT License) — assets/mission_icons/
// 2026-04-19 television 제거(v10s+CoreML 활성에도 tv conf 최고 0.46, 알라미도 동일 부재 확인).
// 2026-04-19 mobile_phone/amphora 추가(COCO cell phone/vase 매칭, Fluent Emoji 존재).
// 2026-04-19 potted_plant 제거(중소형 화분 tgtBest 최대 0.036, 주변 사물 무시하고 target만 필터해도 원시 감지 ~0. v2 학습 이관).
// 2026-04-19 handbag 제거(tgtBest 0.030, top-3에 handbag 자체 0회 등장. v2 학습 이관).
// 2026-04-19 backpack 제거(tgtBest 0.141, 대부분 suitcase/handbag로 오분류. 3 클래스 상호 혼동. v2 학습 이관).
// 2026-04-19 bread(토스터) 제거(tgtBest 0.020, 모델이 sandwich/hot dog로 분류. 가정용 토스터 학습 분포 밖. v2 학습 이관).
// 2026-04-19 amphora 개편(라벨 "꽃병" → "꽃병/화분", cocoLabels 'vase' → ['vase','potted plant']. 실기기 꽃병+식물이 potted plant로 분류되는 현상 대응).

type MissionEntry = {
  key: string;
  emoji: any;
  label: string;       // 한글 노출용
  cocoLabels: string[]; // YOLOv10 COCO 80 class. 기본 단일, nano/small 공통 혼동 쌍만 2원소.
};

// 단일 출처: 이 배열 1개만 유지. 아래 export 4종은 자동 파생.
// 혼동 쌍 그룹화 적용(4 미션): television↔laptop, glass_of_milk↔bowl_with_spoon.
// 실외/비현실 38종은 MISSIONS_DISABLED에 주석 보존 (향후 복원용).
const MISSIONS: MissionEntry[] = [
  // 인물 / 반려 (3)
  { key: 'boy', emoji: require('../../assets/mission_icons/boy.png'), label: '사람', cocoLabels: ['person'] },
  { key: 'cat_face', emoji: require('../../assets/mission_icons/cat_face.png'), label: '고양이', cocoLabels: ['cat'] },
  { key: 'dog_face', emoji: require('../../assets/mission_icons/dog_face.png'), label: '개', cocoLabels: ['dog'] },

  // 소지품 (3) — backpack/handbag 제거(2026-04-19, suitcase 혼동 + 감지 불가)
  { key: 'umbrella', emoji: require('../../assets/mission_icons/umbrella.png'), label: '우산', cocoLabels: ['umbrella'] },
  { key: 'necktie', emoji: require('../../assets/mission_icons/necktie.png'), label: '넥타이', cocoLabels: ['tie'] },
  { key: 'mobile_phone', emoji: require('../../assets/mission_icons/mobile_phone.png'), label: '핸드폰', cocoLabels: ['cell phone'] },

  // 과일 (2)
  { key: 'banana', emoji: require('../../assets/mission_icons/banana.png'), label: '바나나', cocoLabels: ['banana'] },
  { key: 'red_apple', emoji: require('../../assets/mission_icons/red_apple.png'), label: '사과', cocoLabels: ['apple'] },

  // 식기 (7) — glass_of_milk / bowl_with_spoon 쌍 그룹화
  { key: 'bottle_with_popping_cork', emoji: require('../../assets/mission_icons/bottle_with_popping_cork.png'), label: '병', cocoLabels: ['bottle'] },
  { key: 'wine_glass', emoji: require('../../assets/mission_icons/wine_glass.png'), label: '와인잔', cocoLabels: ['wine glass'] },
  { key: 'glass_of_milk', emoji: require('../../assets/mission_icons/glass_of_milk.png'), label: '컵', cocoLabels: ['cup', 'bowl'] },
  { key: 'fork_and_knife', emoji: require('../../assets/mission_icons/fork_and_knife.png'), label: '포크', cocoLabels: ['fork'] },
  { key: 'kitchen_knife', emoji: require('../../assets/mission_icons/kitchen_knife.png'), label: '칼', cocoLabels: ['knife'] },
  { key: 'spoon', emoji: require('../../assets/mission_icons/spoon.png'), label: '숟가락', cocoLabels: ['spoon'] },
  { key: 'bowl_with_spoon', emoji: require('../../assets/mission_icons/bowl_with_spoon.png'), label: '그릇', cocoLabels: ['bowl', 'cup'] },

  // 가구 / 가전 (7) — television/bread 제거(2026-04-19), potted_plant·toilet은 다른 섹션
  { key: 'chair', emoji: require('../../assets/mission_icons/chair.png'), label: '의자', cocoLabels: ['chair'] },
  { key: 'couch_and_lamp', emoji: require('../../assets/mission_icons/couch_and_lamp.png'), label: '소파', cocoLabels: ['couch'] },
  { key: 'bed', emoji: require('../../assets/mission_icons/bed.png'), label: '침대', cocoLabels: ['bed'] },
  { key: 'laptop', emoji: require('../../assets/mission_icons/laptop.png'), label: '노트북', cocoLabels: ['laptop'] },
  { key: 'computer_mouse', emoji: require('../../assets/mission_icons/computer_mouse.png'), label: '마우스', cocoLabels: ['mouse'] },
  { key: 'control_knobs', emoji: require('../../assets/mission_icons/control_knobs.png'), label: '리모컨', cocoLabels: ['remote'] },
  { key: 'amphora', emoji: require('../../assets/mission_icons/amphora.png'), label: '꽃병/화분', cocoLabels: ['vase', 'potted plant'] },

  // 기타 생활용품 (8)
  { key: 'books', emoji: require('../../assets/mission_icons/books.png'), label: '책', cocoLabels: ['book'] },
  { key: 'alarm_clock', emoji: require('../../assets/mission_icons/alarm_clock.png'), label: '시계', cocoLabels: ['clock'] },
  { key: 'scissors', emoji: require('../../assets/mission_icons/scissors.png'), label: '가위', cocoLabels: ['scissors'] },
  { key: 'teddy_bear', emoji: require('../../assets/mission_icons/teddy_bear.png'), label: '인형', cocoLabels: ['teddy bear'] },
  { key: 'toothbrush', emoji: require('../../assets/mission_icons/toothbrush.png'), label: '칫솔', cocoLabels: ['toothbrush'] },
  { key: 'luggage', emoji: require('../../assets/mission_icons/luggage.png'), label: '여행가방', cocoLabels: ['suitcase'] },
  { key: 'keyboard', emoji: require('../../assets/mission_icons/keyboard.png'), label: '키보드', cocoLabels: ['keyboard'] },
  { key: 'toilet', emoji: require('../../assets/mission_icons/toilet.png'), label: '변기', cocoLabels: ['toilet'] },
];

// @preserve — 실외/비현실 38종 (v2+ 복원 후보).
// 배제 사유: 실내 알람 해제 불가. PNG 파일은 assets/mission_icons/에 유지.
// 야생·농장 동물 9: dove, horse, ewe, cow_face, ox, elephant, bear, zebra, giraffe
// 교통 8: bicycle, automobile, motorcycle, airplane, bus, train, delivery_truck, motor_boat
// 도로·시설 4: horizontal_traffic_light, fire_extinguisher, stop_sign, parking_button
// 야외 스포츠 4: skis, snowboarder, kite, person_surfing
// 스포츠 용품 5: flying_disc, basketball, baseball, gloves, skateboard
// 가공 음식 8: sandwich, tangerine, broccoli, carrot, hot_dog, pizza, doughnut, shortcake

export const MISSION_POOL: string[] = MISSIONS.map((m) => m.key);

export const MISSION_EMOJI: Record<string, any> = MISSIONS.reduce(
  (acc, m) => ((acc[m.key] = m.emoji), acc),
  {} as Record<string, any>
);

export const MISSION_LABEL: Record<string, string> = MISSIONS.reduce(
  (acc, m) => ((acc[m.key] = m.label), acc),
  {} as Record<string, string>
);

// worklet에서도 동일 레퍼런스 사용. parseYolov10Output(output, targetLabels: string[]) 시그니처 그대로 호환.
export const MISSION_COCO_LABELS: Record<string, string[]> = MISSIONS.reduce(
  (acc, m) => ((acc[m.key] = m.cocoLabels), acc),
  {} as Record<string, string[]>
);

// @v1.5 — 미션별 confidence 임계값 오버라이드.
// 기본은 앱 상수 TARGET_CONFIDENCE(0.4). COCO 학습 데이터 편향으로 감지율 낮은 미션만 완화.
// 실기기 로그 근거 기반:
// - laptop(0.59), chair(0.47), cup(0.27) → 감지는 되지만 0.4 연속 3프레임 어려움 → 0.2 하향
// - glass_of_milk/bowl_with_spoon: cup/bowl 그룹 쌍이라 대칭 적용
// - amphora: vase 자체 감지 0.05이지만 potted plant 0.40로 잡힘 → 그룹 확장 + 0.3
export const MISSION_CONFIDENCE_OVERRIDE: Record<string, number> = {
  laptop: 0.2,
  chair: 0.2,
  glass_of_milk: 0.2,
  bowl_with_spoon: 0.2,
  amphora: 0.3,
};

// @v1.5-poc — PoC 테스트 편의용 카테고리. AlarmScreen은 여전히 MISSION_POOL 전체 랜덤.
export type MissionCategory = { id: string; label: string; keys: string[] };
export const MISSION_CATEGORIES: MissionCategory[] = [
  { id: 'people_pets', label: '인물·반려', keys: ['boy', 'cat_face', 'dog_face'] },
  { id: 'accessory', label: '소지품', keys: ['umbrella', 'necktie', 'mobile_phone'] },
  { id: 'fruit', label: '과일', keys: ['banana', 'red_apple'] },
  { id: 'utensil', label: '식기', keys: ['bottle_with_popping_cork', 'wine_glass', 'glass_of_milk', 'fork_and_knife', 'kitchen_knife', 'spoon', 'bowl_with_spoon'] },
  { id: 'furniture', label: '가구·가전', keys: ['chair', 'couch_and_lamp', 'bed', 'laptop', 'computer_mouse', 'control_knobs', 'amphora'] },
  { id: 'etc', label: '기타 생활', keys: ['books', 'alarm_clock', 'scissors', 'teddy_bear', 'toothbrush', 'luggage', 'keyboard', 'toilet'] },
];
