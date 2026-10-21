import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../shared/utils/bridge'

const recordingSchema = z.object({ phase:z.enum(['idle','long_pressing','starting','recording','finishing','error']) })
type RecordingPhase = z.infer<typeof recordingSchema>['phase']
const LABELS: Record<RecordingPhase, string> = {
  idle:'准备就绪', long_pressing:'准备录音', starting:'启动麦克风', recording:'正在聆听', finishing:'整理文字', error:'录音异常'
}
export function useRecordingPhase() {
  const [phase,setPhase] = useState<RecordingPhase | 'unavailable' | 'loading'>('loading')
  useEffect(() => {
    let active=true, receivedState=false
    const update=(value:unknown) => {
      const result=recordingSchema.safeParse(value)
      if (active) setPhase(result.success ? result.data.phase : 'unavailable')
    }
    const off=api.recording.onState(value => { receivedState=true; update(value) })
    void api.recording.state().then((value:unknown) => { if (!receivedState) update(value) }).catch(() => { if (active && !receivedState) setPhase('unavailable') })
    return () => { active=false; off?.() }
  },[])
  return { phase, label:phase==='loading' ? '连接中' : phase==='unavailable' ? '状态暂不可用' : LABELS[phase] }
}
