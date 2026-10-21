/** A local line drawing for microphone setup, sharing the homepage's instrument grammar. */
export function VoiceInstrument() {
  return <svg className="voice-instrument" viewBox="0 0 360 360" fill="none" aria-hidden="true">
    <g stroke="currentColor"><path d="M16 44V16h28m272 0h28v28M16 316v28h28m272 0h28v-28" opacity=".4" />
      <circle cx="180" cy="180" r="144" strokeDasharray="1 8" opacity=".55" />
      <circle cx="180" cy="180" r="123" opacity=".2" />
      <path d="M180 24v44m0 224v44M24 180h44m224 0h44" opacity=".45" />
      {Array.from({length:24},(_,i)=><path key={i} d="M180 34v8" transform={`rotate(${i*15} 180 180)`} />)}
      <rect x="149" y="105" width="62" height="118" rx="31" strokeWidth="1.5" />
      <path d="M131 181v13a49 49 0 0098 0v-13M180 243v24m-32 0h64M163 130h34m-34 12h34m-34 12h34m-34 12h34" strokeWidth="1.5" />
      <path d="M105 153v54m-9-42v30m159-42v54m9-42v30" opacity=".65" />
      <circle cx="286" cy="97" r="5" fill="#ffd700" />
    </g>
    <g fill="currentColor" fontFamily="var(--font-mono)" fontSize="10"><text x="180" y="54" textAnchor="middle">VOICE INPUT</text><text x="180" y="318" textAnchor="middle">OFFKEY / 01</text></g>
  </svg>
}
