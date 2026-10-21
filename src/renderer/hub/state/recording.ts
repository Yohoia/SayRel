import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../shared/utils/bridge'

const recordingSchema = z.object({ phase:z.enum(['idle','long_pressing','starting','recording','finishing','error']) })
type RecordingPhase = z.infer<typeof recordingSchema>['phase']
const LABELS: Record<RecordingPhase, string> = {
  idle:"Ready", long_pressing:"Getting ready", starting:"Starting microphone", recording:"Listening", finishing:"Refining text", error:"Recording error"
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
  return { phase, label:phase==='loading' ? "Connecting" : phase==='unavailable' ? "Status unavailable" : LABELS[phase] }
}
