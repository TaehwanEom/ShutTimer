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
  /** v1.6 Phase 12 — LA stage. 'step' (default) | 'manual_prompt' (수동 모드 alerting 후 다음 진행 대기) */
  stage?: string;
  /** v1.6 hotfix — 0-based 현재 step index. 위젯 "stepName(N/M)" 표시용 */
  currentStepIndex?: number;
  /** v1.6 hotfix — 총 step 수 */
  totalSteps?: number;
};

export type LiveActivityUpdateParams = {
  activityId: string;
  stepName: string;
  stepEndAt: number;
  progress: number;
  /** v1.6 Phase 12 — LA stage. 'step' | 'manual_prompt' */
  stage?: string;
  /** v1.6 hotfix — 위젯 "stepName(N/M)" 표시용 */
  currentStepIndex?: number;
  totalSteps?: number;
  /** v1.7 hotfix #30 — paused field. ar.pausedAt !== null 시 true 전달. 누락 시 false 보존. */
  paused?: boolean;
};

export type LiveActivityDismissalPolicy = 'immediate' | 'default';

export type LiveActivityEndParams = {
  activityId: string;
  /** immediate = 즉시 사라짐 / default = iOS 가 결정 (4시간 내) */
  dismissalPolicy?: LiveActivityDismissalPolicy;
};
