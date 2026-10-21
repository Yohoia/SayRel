import { useEffect, useRef, useState } from 'react'
import CloseRounded from '@mui/icons-material/CloseRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { api, bridge } from '../shared/utils/bridge'
import { toast } from '../shared/components/Toast'
import '../shared/styles/secondary.css'

type Payload = {
  id: string
  mode: string
  title: string | null
  userPrompt?: string | null
  selectedText?: string | null
  answer: string
  createdAt: number
}

export function CardApp() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [copied, setCopied] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)
  const promptRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => {
    api.page.cardPayload().then((data: Payload | null) => setPayload(data)).catch(() => undefined)
    const off = window.offkey.on('interactive-card:update', (data: Payload) => { setPayload(data); setExpanded(false) })
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') void api.page.closeCard() }
    window.addEventListener('keydown', onKey)
    return () => { off?.(); window.removeEventListener('keydown', onKey) }
  }, [])

  useEffect(() => {
    const element = promptRef.current
    if (!element) return
    const update = () => setCollapsible(element.scrollHeight > 44)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [payload])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    let lastHeight = 0
    const resize = () => {
      const height = Math.ceil(card.getBoundingClientRect().height) + 88
      if (Math.abs(height - lastHeight) <= 10) return
      lastHeight = height
      void bridge.invoke('page:update-interactive-card-bounds', { height }).catch(() => undefined)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(card)
    resize()
    return () => observer.disconnect()
  }, [payload])

  const copy = async () => {
    if (!payload) return
    try {
      await api.clipboard.writeText(payload.answer)
      setCopied(true); toast.success('复制成功')
      setTimeout(() => setCopied(false), 3000)
    } catch { toast.error('复制失败，请重试') }
  }

  if (!payload) return null

  return (
    <main className="secondary-card-shell">
      <section className="secondary-result-card" ref={cardRef}>
        <header className="secondary-result-brandbar drag">
          <img className="secondary-result-logo" src="./assets/brand/offkey-logo-horizontal-800x250.png" alt="Offkey" />
          <button className="secondary-icon-button no-drag" aria-label="关闭回答" title="关闭 · Esc" onClick={() => api.page.closeCard()}><CloseRounded /></button>
        </header>
        <div className="secondary-result-scroll no-drag">
          {(payload.userPrompt || payload.title) && <section className="secondary-result-prompt"><div ref={promptRef} className={expanded ? 'is-expanded' : ''}><div className="secondary-prompt-row"><MicRounded /><p>{payload.userPrompt || payload.title}</p><button className={`secondary-icon-button ${promptCopied ? 'is-copied' : ''}`} aria-label="复制问题" title={promptCopied ? '已复制' : '复制'} onClick={async () => { try { await api.clipboard.writeText([payload.userPrompt || payload.title, payload.selectedText].filter(Boolean).join('\n')); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 3000); toast.success('复制成功') } catch { toast.error('复制失败，请重试') } }}>{promptCopied ? <CheckRounded /> : <CopyIcon />}</button></div>{payload.selectedText && <div className="secondary-selected-text">{payload.selectedText}</div>}</div>{collapsible && <button className="secondary-prompt-toggle" onClick={() => setExpanded(!expanded)}>{expanded ? '显示更少' : '...更多'}</button>}</section>}
          <article className="secondary-answer">
            <header><h1><AnswerIcon />回答</h1><button className={`secondary-icon-button ${copied ? 'is-copied' : ''}`} aria-label={copied ? "已复制" : "复制回答"} title={copied ? "已复制" : "复制回答"} onClick={copy}>{copied ? <CheckRounded /> : <CopyIcon />}</button></header>
            <div className="secondary-answer-content">{payload.answer}</div>
          </article>
        </div>
      </section>
    </main>
  )
}

// Original Typeless custom icons from the shipped BYNd6ENk card component.
function CopyIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.2863 5.84924C11.2862 5.4056 10.9495 5.04054 10.5175 4.99651L10.4297 4.99256L6.03869 4.99256C5.56532 4.99256 5.18119 5.3759 5.18103 5.84924L5.18103 10.5896C5.18129 11.0628 5.56537 11.4463 6.03869 11.4463L10.4297 11.4463C10.9029 11.4462 11.2861 11.0628 11.2863 10.5896L11.2863 5.84924ZM9.37262 2.83212L9.37361 2.83409C9.37465 2.83537 9.3757 2.83699 9.37657 2.83804C9.37824 2.84004 9.37947 2.84176 9.38052 2.84298C9.38227 2.84499 9.38348 2.84594 9.38348 2.84594C9.38242 2.84482 9.3758 2.83783 9.36374 2.82718C9.33955 2.80583 9.29253 2.76844 9.22063 2.72849C9.08048 2.65069 8.8279 2.55182 8.4291 2.55182L4.73789 2.55281C3.6357 2.55281 2.74131 3.44625 2.74128 4.54843L2.74128 9.13876C2.74128 9.49752 2.91836 9.83368 3.21403 10.0369C3.48992 10.2266 3.55963 10.6038 3.36997 10.8797C3.18025 11.1556 2.80306 11.2253 2.52711 11.0357C1.90238 10.6062 1.5293 9.89687 1.5293 9.13876L1.5293 4.54843C1.52933 2.77662 2.96514 1.3411 4.7369 1.34083L8.4291 1.33984L8.65116 1.34675C9.15205 1.37865 9.5345 1.51554 9.80985 1.6685C9.96519 1.75481 10.083 1.84385 10.1661 1.91721C10.2077 1.9539 10.2408 1.98742 10.2658 2.01393C10.2782 2.02712 10.2889 2.03862 10.2974 2.04848C10.3017 2.05343 10.3059 2.05828 10.3092 2.06229C10.3107 2.06401 10.3119 2.0657 10.3132 2.06723C10.3139 2.06805 10.3145 2.06942 10.3152 2.07019L10.3171 2.07216L10.3843 2.17579C10.5126 2.42686 10.4512 2.74189 10.2224 2.92489C9.99365 3.10763 9.67317 3.09821 9.45652 2.91798L9.37262 2.83212ZM12.4993 10.5896C12.499 11.7326 11.5727 12.6592 10.4297 12.6592L6.03869 12.6592C4.89558 12.6592 3.96832 11.7326 3.96806 10.5896L3.96806 5.84924C3.96823 4.70611 4.89552 3.7796 6.03869 3.7796L10.4504 3.7796L10.4731 3.78157C11.5961 3.80477 12.4991 4.72068 12.4993 5.84924L12.4993 10.5896Z" fill="currentColor" /></svg>
}
function AnswerIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.7686 1.5839V2.42839H12.6131C12.9575 2.42839 13.2363 2.70821 13.2363 3.05263C13.2362 3.39694 12.9574 3.67585 12.6131 3.67585H11.7686V4.52035C11.7686 4.86463 11.4896 5.14436 11.1454 5.14458C10.801 5.14458 10.5212 4.86477 10.5212 4.52035V3.67585H9.67666C9.33242 3.67574 9.05357 3.39687 9.05344 3.05263C9.05344 2.70828 9.33233 2.4285 9.67666 2.42839H10.5212V1.5839C10.5214 1.23965 10.8011 0.960678 11.1454 0.960678C11.4895 0.960897 11.7684 1.23978 11.7686 1.5839ZM6.47935 12.7653C6.26944 12.8442 6.03764 12.8441 5.82771 12.7653L5.72418 12.7186L5.6379 12.6669C5.45056 12.5357 5.35591 12.3477 5.31107 12.2558C5.2485 12.1275 5.18405 11.9601 5.11821 11.7889L4.55285 10.3181C4.37585 9.85794 4.32185 9.73093 4.24936 9.62893C4.17565 9.52527 4.08505 9.43468 3.98139 9.36097C3.87938 9.28843 3.75245 9.2345 3.2922 9.05748L1.82144 8.4911C1.65011 8.4252 1.48182 8.36188 1.35351 8.29926C1.24846 8.24798 1.01978 8.131 0.89168 7.88615C0.75121 7.61728 0.75121 7.2963 0.89168 7.02744C1.01976 6.78256 1.24844 6.66562 1.35351 6.61433C1.48183 6.5517 1.65009 6.48737 1.82144 6.42147L3.2922 5.85611C3.75247 5.67908 3.87938 5.62516 3.98139 5.55262C4.08506 5.4789 4.17564 5.38833 4.24936 5.28465C4.32187 5.18264 4.37583 5.05572 4.55285 4.59546L5.11821 3.1247C5.18411 2.95336 5.24844 2.78509 5.31107 2.65677C5.3624 2.55161 5.47932 2.32295 5.72418 2.19494C5.99304 2.05447 6.31402 2.05447 6.58289 2.19494C6.82767 2.32303 6.94471 2.5517 6.996 2.65677C7.05861 2.78507 7.12195 2.95339 7.18784 3.1247L7.75422 4.59546C7.93102 5.05514 7.9843 5.18271 8.05669 5.28465C8.13042 5.38834 8.22198 5.47889 8.32567 5.55262C8.42767 5.62511 8.55471 5.67913 9.01487 5.85611L10.4856 6.42147C10.6568 6.48732 10.8243 6.55175 10.9525 6.61433C11.0575 6.66556 11.2872 6.78229 11.4154 7.02744C11.5559 7.2963 11.5559 7.61728 11.4154 7.88615L11.3636 7.97242C11.2324 8.15971 11.0444 8.25442 10.9525 8.29926C10.8243 8.36179 10.6567 8.4253 10.4856 8.4911L9.01487 9.05748C8.55465 9.23448 8.42768 9.28847 8.32567 9.36097C8.22198 9.43469 8.13042 9.52524 8.05669 9.62893C7.98432 9.73088 7.93101 9.85847 7.75422 10.3181L7.18784 11.7889C7.12204 11.9599 7.05852 12.1276 6.996 12.2558C6.94478 12.3608 6.8279 12.5905 6.58289 12.7186L6.47935 12.7653ZM6.58999 9.87051C6.74407 9.4699 6.8558 9.16633 7.04066 8.90624C7.19513 8.689 7.38474 8.49841 7.60196 8.34392C7.86213 8.15893 8.16648 8.04739 8.56725 7.89325L9.70305 7.45679L8.56725 7.02033C8.16648 6.86619 7.86213 6.75466 7.60196 6.56967C7.38472 6.41517 7.19514 6.2246 7.04066 6.00735C6.85578 5.74724 6.74408 5.44372 6.58999 5.04308L6.15353 3.90931L5.71707 5.04308C5.56301 5.44364 5.45122 5.74728 5.26641 6.00735C5.11188 6.22466 4.9214 6.41514 4.70409 6.56967C4.44399 6.75454 4.14044 6.86625 3.73982 7.02033L2.60503 7.45679L3.73982 7.89325C4.14044 8.04734 4.44399 8.15904 4.70409 8.34392C4.9214 8.49844 5.11188 8.68892 5.26641 8.90624C5.4512 9.1663 5.56302 9.46998 5.71707 9.87051L6.15353 11.0053L6.58999 9.87051Z" fill="currentColor" /></svg>
}
