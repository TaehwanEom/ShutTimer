// v2.0 P2.5 — Session state subscribe React hook.
//
// UI 컴포넌트가 dispatch 결과를 자동으로 받아 re-render.
// 기존 DeviceEventEmitter listener 7종 + AsyncStorage polling 패턴을 대체.
// P3 단계에서 screens (HomeScreen / AlarmScreen / RoutineListScreen / ActiveRoutineSection) 가
//   loadActiveRoutine / setInterval 직접 호출 대신 본 hook 으로 전환.

import { useEffect, useState } from 'react';
import { Session } from '../types/session';
import { getCurrentSession, subscribe } from './SessionController';
import { sessionToActiveRoutine } from './effectRunner';
import { ActiveRoutine } from '../constants/routines';

/**
 * 현재 active session 구독. dispatch 발생 시마다 자동 갱신.
 *
 * @returns [session, loading]
 *   session: null = IDLE 또는 아직 미로딩. Session = active.
 *   loading: 초기 load 진행 중. UI 측 spinner 가드용.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    // 1. 초기 load
    getCurrentSession()
      .then((s) => {
        if (mounted) {
          setSession(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setLoading(false);
        }
      });

    // 2. dispatch 갱신 구독
    const unsubscribe = subscribe((next) => {
      if (mounted) setSession(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { session, loading };
}

/**
 * derived state — session.state 만 필요한 곳 (예: 버튼 disabled 조건).
 */
export function useSessionState(): { state: Session['state'] | 'IDLE'; loading: boolean } {
  const { session, loading } = useSession();
  return { state: session?.state ?? 'IDLE', loading };
}

/**
 * derived state — 현재 진행 중인 step.
 */
export function useCurrentStep(): { step: Session['steps'][0] | null; index: number } {
  const { session } = useSession();
  if (!session) return { step: null, index: -1 };
  return {
    step: session.steps[session.currentStepIndex] ?? null,
    index: session.currentStepIndex,
  };
}

/**
 * v2.0 C-3 — 옛 ActiveRoutine 호환 hook.
 *
 * 옛 caller (ActiveRoutineSection / RoutineAlarmScreen / RoutineListScreen 등) 측 loadActiveRoutine + setAr 패턴 대체.
 * Session → sessionToActiveRoutine 측 ar 형식 자동 변환 + dispatch 갱신 시 자동 re-render.
 *
 * @returns { ar: ActiveRoutine | null; loading: boolean }
 *   ar: null = 비활성 또는 IDLE / ActiveRoutine = 진행 중.
 *
 * routine / ad_hoc_routine kind 측만 ar 측 의미 — timer / simple_alarm kind 측 caller 측 별도 hook 측 처리.
 */
export function useActiveRoutineAr(): { ar: ActiveRoutine | null; loading: boolean } {
  const { session, loading } = useSession();
  if (!session) return { ar: null, loading };
  if (session.kind !== 'routine' && session.kind !== 'ad_hoc_routine') {
    return { ar: null, loading };
  }
  return { ar: sessionToActiveRoutine(session), loading };
}
