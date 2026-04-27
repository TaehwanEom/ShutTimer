// v1.6 T3 — Live Activity bridge 타입 정의.
// targets/widget/WidgetLiveActivity.swift 의 ShutTimerActivityAttributes 와 정합.

export type LiveActivityStartParams = {
  /** 루틴 식별자 (불변 attribute) */
  routineId: string;
  /** 루틴 이름 (불변 attribute) */
  routineName: string;
  /** 현재 step 이름 (가변 ContentState) */
  stepName: string;
  /** 현재 step 종료 timestamp (ms) */
  stepEndAt: number;
  /** 진행률 0~1 */
  progress: number;
};

export type LiveActivityUpdateParams = {
  activityId: string;
  stepName: string;
  stepEndAt: number;
  progress: number;
};

export type LiveActivityDismissalPolicy = 'immediate' | 'default';

export type LiveActivityEndParams = {
  activityId: string;
  /** immediate = 즉시 사라짐 / default = iOS 가 결정 (4시간 내) */
  dismissalPolicy?: LiveActivityDismissalPolicy;
};
