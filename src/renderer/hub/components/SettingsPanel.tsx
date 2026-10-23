import { BrandLockup } from '../../shared/components/BrandLockup'
import { useEffect, useRef, useState } from 'react'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import ArrowOutward from '@mui/icons-material/ArrowOutward'
import ShieldOutlined from '@mui/icons-material/ShieldOutlined'
import { api } from '../../shared/utils/bridge'
import { checkForUpdates } from '../../shared/utils/checkForUpdates'
import { useAppSettings } from '../../shared/state/settings'
import { ShortcutEditor, TranslationTargets, LanguageVariants } from './SettingsControls'
import { MicrophonePicker } from './MicrophonePicker'
import { useFeatureTour } from './FeatureTour'
import { interfaceLanguages, useSettingsText, type SettingsTextKey } from './settingsText'
import '../../shared/styles/settings.css'
import { HubSelect } from './HubSelect'
import { SettingsPermissions } from './SettingsPermissions'
import { toast } from '../../shared/components/Toast'

const SECTIONS = ['settings', 'writing', 'about', 'help'] as const
type Section = (typeof SECTIONS)[number]
const TITLES = {
  settings: { text: "Settings", key: 'hub__settings__title' },
  writing: { text: "Personalization", key: 'hub__settings__personal__title' },
  about: { text: "About", key: 'hub__about__title' },
  help: { text: "Help", key: 'hub__help__title' }
} satisfies Record<Section, { text: string; key: SettingsTextKey }>
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  permissions: <ShieldOutlined />,
  shortcuts: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.75 6.90015C15.75 6.46773 15.7491 6.18834 15.7317 5.97583C15.715 5.77214 15.6869 5.69651 15.668 5.65943C15.5961 5.51845 15.4816 5.40391 15.3406 5.33203C15.3035 5.31314 15.2279 5.28496 15.0242 5.26831C14.8117 5.25095 14.5323 5.25 14.0999 5.25H3.90015C3.46773 5.25 3.18834 5.25095 2.97583 5.26831C2.77214 5.28496 2.69651 5.31314 2.65943 5.33203C2.51845 5.40391 2.40391 5.51845 2.33203 5.65943C2.31314 5.69651 2.28496 5.77214 2.26831 5.97583C2.25095 6.18834 2.25 6.46773 2.25 6.90015V11.0999C2.25 11.5323 2.25095 11.8117 2.26831 12.0242C2.28496 12.2279 2.31314 12.3035 2.33203 12.3406C2.40391 12.4816 2.51845 12.5961 2.65943 12.668C2.69651 12.6869 2.77214 12.715 2.97583 12.7317C3.18834 12.7491 3.46773 12.75 3.90015 12.75H14.0999C14.5323 12.75 14.8117 12.7491 15.0242 12.7317C15.2279 12.715 15.3035 12.6869 15.3406 12.668C15.4816 12.5961 15.5961 12.4816 15.668 12.3406C15.6869 12.3035 15.715 12.2279 15.7317 12.0242C15.7491 11.8117 15.75 11.5323 15.75 11.0999V6.90015ZM6.00733 9.75C6.42154 9.75 6.75733 10.0858 6.75733 10.5C6.75733 10.9142 6.42154 11.25 6.00733 11.25H6C5.58579 11.25 5.25 10.9142 5.25 10.5C5.25 10.0858 5.58579 9.75 6 9.75H6.00733ZM9.00733 9.75C9.42154 9.75 9.75733 10.0858 9.75733 10.5C9.75733 10.9142 9.42154 11.25 9.00733 11.25H9C8.58579 11.25 8.25 10.9142 8.25 10.5C8.25 10.0858 8.58579 9.75 9 9.75H9.00733ZM12.0073 9.75C12.4215 9.75 12.7573 10.0858 12.7573 10.5C12.7573 10.9142 12.4215 11.25 12.0073 11.25H12C11.5858 11.25 11.25 10.9142 11.25 10.5C11.25 10.0858 11.5858 9.75 12 9.75H12.0073ZM4.50733 6.75C4.92154 6.75 5.25733 7.08579 5.25733 7.5C5.25733 7.91422 4.92154 8.25 4.50733 8.25H4.5C4.08579 8.25 3.75 7.91422 3.75 7.5C3.75 7.08579 4.08579 6.75 4.5 6.75H4.50733ZM7.50733 6.75C7.92154 6.75 8.25733 7.08579 8.25733 7.5C8.25733 7.91422 7.92154 8.25 7.50733 8.25H7.5C7.08579 8.25 6.75 7.91422 6.75 7.5C6.75 7.08579 7.08579 6.75 7.5 6.75H7.50733ZM10.5073 6.75C10.9215 6.75 11.2573 7.08579 11.2573 7.5C11.2573 7.91422 10.9215 8.25 10.5073 8.25H10.5C10.0858 8.25 9.75 7.91422 9.75 7.5C9.75 7.08579 10.0858 6.75 10.5 6.75H10.5073ZM13.5073 6.75C13.9215 6.75 14.2573 7.08579 14.2573 7.5C14.2573 7.91422 13.9215 8.25 13.5073 8.25H13.5C13.0858 8.25 12.75 7.91422 12.75 7.5C12.75 7.08579 13.0858 6.75 13.5 6.75H13.5073ZM17.25 11.0999C17.25 11.5075 17.2508 11.8587 17.2273 12.1465C17.2031 12.4429 17.1492 12.738 17.0046 13.0217C16.789 13.4449 16.4449 13.789 16.0217 14.0046C15.738 14.1492 15.4429 14.2031 15.1465 14.2273C14.8587 14.2508 14.5075 14.25 14.0999 14.25H3.90015C3.49249 14.25 3.14127 14.2508 2.85352 14.2273C2.55708 14.2031 2.262 14.1492 1.97827 14.0046C1.55511 13.789 1.21105 13.4449 0.995365 13.0217C0.850801 12.738 0.796942 12.4429 0.772708 12.1465C0.749198 11.8587 0.750003 11.5075 0.750003 11.0999V6.90015C0.750003 6.49249 0.749198 6.14127 0.772708 5.85352C0.796942 5.55708 0.850801 5.262 0.995365 4.97827C1.21105 4.55511 1.55511 4.21105 1.97827 3.99536C2.262 3.8508 2.55708 3.79694 2.85352 3.77271C3.14127 3.7492 3.49249 3.75 3.90015 3.75H14.0999C14.5075 3.75 14.8587 3.7492 15.1465 3.77271C15.4429 3.79694 15.738 3.8508 16.0217 3.99536C16.4449 4.21105 16.789 4.55511 17.0046 4.97827C17.1492 5.262 17.2031 5.55708 17.2273 5.85352C17.2508 6.14127 17.25 6.49249 17.25 6.90015V11.0999Z" fill="currentColor" /></svg>,
  language: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.00001 1.47949C13.154 1.47949 16.5209 4.84645 16.5209 9.00042C16.5209 13.1544 13.154 16.5213 9.00001 16.5213C4.84604 16.5213 1.47908 13.1544 1.47908 9.00042C1.47908 4.84645 4.84604 1.47949 9.00001 1.47949ZM3.07241 9.77135C3.37476 12.1192 5.03753 14.0403 7.24596 14.7171C6.30544 13.2299 5.73086 11.5352 5.57353 9.77135H3.07241ZM12.4265 9.77135C12.2691 11.5355 11.6935 13.2298 10.7528 14.7171C12.9618 14.0406 14.6252 12.1196 14.9276 9.77135H12.4265ZM7.12166 9.77135C7.30141 11.5042 7.95084 13.1546 9.00001 14.5438C10.0492 13.1546 10.6986 11.5042 10.8784 9.77135H7.12166ZM10.7528 3.28251C11.6939 4.77004 12.2691 6.46503 12.4265 8.22949H14.9276C14.6252 5.88109 12.962 3.95889 10.7528 3.28251ZM9.00001 3.45578C7.95049 4.84516 7.30144 6.49629 7.12166 8.22949H10.8784C10.6986 6.49629 10.0495 4.84516 9.00001 3.45578ZM7.24596 3.28251C5.03736 3.9592 3.37478 5.88149 3.07241 8.22949H5.57353C5.73089 6.46525 6.3051 4.7699 7.24596 3.28251Z" fill="currentColor" /></svg>,
  audio: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 10.5C8.375 10.5 7.84375 10.2812 7.40625 9.84375C6.96875 9.40625 6.75 8.875 6.75 8.25V3.75C6.75 3.125 6.96875 2.59375 7.40625 2.15625C7.84375 1.71875 8.375 1.5 9 1.5C9.625 1.5 10.1562 1.71875 10.5938 2.15625C11.0312 2.59375 11.25 3.125 11.25 3.75V8.25C11.25 8.875 11.0312 9.40625 10.5938 9.84375C10.1562 10.2812 9.625 10.5 9 10.5ZM8.25 15.75V13.4438C6.95 13.2688 5.875 12.6875 5.025 11.7C4.175 10.7125 3.75 9.5625 3.75 8.25H5.25C5.25 9.2875 5.61563 10.1719 6.34688 10.9031C7.07812 11.6344 7.9625 12 9 12C10.0375 12 10.9219 11.6344 11.6531 10.9031C12.3844 10.1719 12.75 9.2875 12.75 8.25H14.25C14.25 9.5625 13.825 10.7125 12.975 11.7C12.125 12.6875 11.05 13.2688 9.75 13.4438V15.75H8.25ZM9 9C9.2125 9 9.39062 8.92813 9.53438 8.78438C9.67812 8.64063 9.75 8.4625 9.75 8.25V3.75C9.75 3.5375 9.67812 3.35938 9.53438 3.21563C9.39062 3.07188 9.2125 3 9 3C8.7875 3 8.60938 3.07188 8.46562 3.21563C8.32188 3.35938 8.25 3.5375 8.25 3.75V8.25C8.25 8.4625 8.32188 8.64063 8.46562 8.78438C8.60938 8.92813 8.7875 9 9 9Z" fill="currentColor" /></svg>,
  general: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.4814 12.6354C15.4357 12.6337 15.3723 12.6342 15.2636 12.6342H2.73473C2.62469 12.6342 2.56147 12.6337 2.51571 12.6354C2.51398 12.6811 2.5145 12.7444 2.5145 12.8544C2.5145 13.3504 2.52116 13.4533 2.5387 13.5187C2.6036 13.7608 2.79284 13.9498 3.03482 14.0148C3.10028 14.0324 3.20315 14.039 3.69914 14.039H14.3004C14.7957 14.039 14.898 14.0323 14.9635 14.0148C15.2057 13.9499 15.3946 13.7609 15.4596 13.5187C15.4771 13.4533 15.4838 13.3504 15.4838 12.8544C15.4838 12.7443 15.4831 12.6811 15.4814 12.6354ZM14.7614 5.52998C14.7614 5.11338 14.7611 4.84545 14.7444 4.64181C14.7285 4.44673 14.7016 4.37648 14.6852 4.34414C14.6178 4.21208 14.5099 4.1053 14.3778 4.038C14.3455 4.02152 14.2752 3.99464 14.0801 3.9787C13.8765 3.9621 13.6086 3.96055 13.192 3.96055H4.80754C4.39047 3.96055 4.12192 3.96206 3.91816 3.9787C3.72376 3.9946 3.65413 4.02151 3.62169 4.038C3.48965 4.10527 3.38167 4.21213 3.31434 4.34414C3.29786 4.37648 3.27099 4.44673 3.25505 4.64181C3.23842 4.84546 3.23811 5.11336 3.23811 5.52998V11.1482H14.7614V5.52998ZM16.2485 11.3503C16.5205 11.5104 16.7357 11.7553 16.8584 12.0497L16.9213 12.2349L16.9528 12.3958C16.9747 12.5582 16.9709 12.7225 16.9709 12.8544C16.9709 13.2547 16.9769 13.6013 16.8959 13.9035C16.6934 14.6588 16.1036 15.2488 15.3483 15.4512C15.0462 15.5321 14.7004 15.5262 14.3004 15.5262H3.69914C3.29888 15.5262 2.95223 15.5321 2.65003 15.4512C1.89487 15.2486 1.30476 14.6587 1.10238 13.9035C1.0214 13.6013 1.02856 13.2547 1.02856 12.8544C1.02855 12.6783 1.02197 12.4449 1.07818 12.2349L1.1411 12.0497C1.26386 11.7552 1.4789 11.5104 1.75096 11.3503V5.52998C1.75096 5.13782 1.75003 4.79897 1.77274 4.5208C1.79619 4.23377 1.84826 3.94582 1.98934 3.66893C2.19922 3.25717 2.53469 2.92282 2.94649 2.71299C3.22328 2.572 3.51023 2.51985 3.79715 2.4964C4.0755 2.47365 4.415 2.47462 4.80754 2.47462H13.192C13.5844 2.47462 13.924 2.47366 14.2023 2.4964C14.4892 2.51987 14.7763 2.572 15.053 2.71299C15.4648 2.92285 15.8003 3.25714 16.0102 3.66893C16.1512 3.94582 16.2021 4.23377 16.2255 4.5208C16.2483 4.79898 16.2485 5.13779 16.2485 5.52998V11.3503Z" fill="currentColor" /></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g><path d="M13.3125 15.1875C12.525 15.1875 11.8594 14.9156 11.3156 14.3719C10.7719 13.8281 10.5 13.1625 10.5 12.375C10.5 11.5875 10.7719 10.9219 11.3156 10.3781C11.8594 9.83438 12.525 9.5625 13.3125 9.5625C14.1 9.5625 14.7656 9.83438 15.3094 10.3781C15.8531 10.9219 16.125 11.5875 16.125 12.375C16.125 13.1625 15.8531 13.8281 15.3094 14.3719C14.7656 14.9156 14.1 15.1875 13.3125 15.1875ZM13.3125 13.6875C13.675 13.6875 13.9844 13.5594 14.2406 13.3031C14.4969 13.0469 14.625 12.7375 14.625 12.375C14.625 12.0125 14.4969 11.7031 14.2406 11.4469C13.9844 11.1906 13.675 11.0625 13.3125 11.0625C12.95 11.0625 12.6406 11.1906 12.3844 11.4469C12.1281 11.7031 12 12.0125 12 12.375C12 12.7375 12.1281 13.0469 12.3844 13.3031C12.6406 13.5594 12.95 13.6875 13.3125 13.6875ZM3 13.125V11.625H9V13.125H3ZM4.6875 8.4375C3.9 8.4375 3.23438 8.16563 2.69062 7.62187C2.14687 7.07812 1.875 6.4125 1.875 5.625C1.875 4.8375 2.14687 4.17188 2.69062 3.62812C3.23438 3.08437 3.9 2.8125 4.6875 2.8125C5.475 2.8125 6.14062 3.08437 6.68437 3.62812C7.22813 4.17188 7.5 4.8375 7.5 5.625C7.5 6.4125 7.22813 7.07812 6.68437 7.62187C6.14062 8.16563 5.475 8.4375 4.6875 8.4375ZM4.6875 6.9375C5.05 6.9375 5.35938 6.80938 5.61563 6.55313C5.87188 6.29688 6 5.9875 6 5.625C6 5.2625 5.87188 4.95312 5.61563 4.69688C5.35938 4.44063 5.05 4.3125 4.6875 4.3125C4.325 4.3125 4.01562 4.44063 3.75938 4.69688C3.50313 4.95312 3.375 5.2625 3.375 5.625C3.375 5.9875 3.50313 6.29688 3.75938 6.55313C4.01562 6.80938 4.325 6.9375 4.6875 6.9375ZM9 6.375V4.875H15V6.375H9Z" fill="currentColor" /></g></svg>
}

function CategoryIcon({ name }: { name: string }) {
  return <span className="settings-icon" aria-hidden="true">{CATEGORY_ICONS[name] ?? CATEGORY_ICONS.settings}</span>
}

function NavigationIcon({ section }: { section: Section }) {
  if (section === "help") return <span className="settings-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M13.543 7.99999C13.543 4.93936 11.0614 2.45777 8.00073 2.45777C4.94009 2.45777 2.4585 4.93936 2.4585 7.99999C2.4585 11.0606 4.94009 13.5422 8.00073 13.5422C11.0614 13.5422 13.543 11.0606 13.543 7.99999ZM8.00654 10.4138C8.40146 10.4138 8.72231 10.7335 8.72231 11.1284C8.72231 11.5233 8.40146 11.843 8.00654 11.843H8.00073C7.6058 11.843 7.28613 11.5233 7.28612 11.1284C7.28612 10.7335 7.6058 10.4138 8.00073 10.4138H8.00654ZM6.63786 4.51079C7.1655 4.20087 7.78632 4.08728 8.38945 4.19073C8.9926 4.29431 9.53975 4.60823 9.93387 5.07642C10.3279 5.54451 10.5433 6.13702 10.5426 6.74886L10.5344 6.93275C10.4509 7.83455 9.76609 8.43152 9.28561 8.75184C9.00801 8.93686 8.73537 9.0724 8.53493 9.16151C8.43362 9.20653 8.34763 9.24156 8.28587 9.26509C8.25509 9.27682 8.22979 9.28531 8.21138 9.29186C8.20241 9.29505 8.19499 9.29804 8.18927 9.30001C8.18637 9.301 8.18311 9.30166 8.18112 9.30233L8.17879 9.3035H8.17647C7.80187 9.42828 7.39706 9.22649 7.27216 8.85193C7.14737 8.47755 7.34961 8.07283 7.72373 7.94762L7.73188 7.94413C7.74091 7.94092 7.75688 7.9356 7.77727 7.92783C7.8181 7.91227 7.8788 7.88749 7.95301 7.85451C8.10437 7.78724 8.30176 7.68874 8.49303 7.56122C8.91867 7.27736 9.11207 6.9948 9.1122 6.74886C9.11261 6.47445 9.01658 6.20695 8.83986 5.99702C8.66318 5.78722 8.41769 5.64656 8.14737 5.60015C7.87691 5.55375 7.59836 5.60542 7.36177 5.74446C7.12534 5.88351 6.94537 6.10139 6.85434 6.36014C6.72333 6.73255 6.31549 6.92852 5.94305 6.79774C5.57051 6.66669 5.37439 6.25783 5.50544 5.88529C5.70862 5.30797 6.11021 4.8209 6.63786 4.51079ZM14.9722 7.99999C14.9722 11.8505 11.8512 14.9714 8.00073 14.9714C4.15025 14.9714 1.0293 11.8505 1.0293 7.99999C1.0293 4.14952 4.15025 1.02856 8.00073 1.02856C11.8512 1.02856 14.9722 4.14952 14.9722 7.99999Z" fill="currentColor" /></svg></span>
  if (section === "about") return <InfoOutlined className="settings-icon" />
  if (section === "writing") return <span className="settings-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.23237 1.74895C7.13952 1.28237 8.09383 1.31361 8.87188 1.72886C10.4407 2.56617 11.0363 4.75369 9.72232 6.82261C8.84822 8.19872 7.73994 9.72344 6.4433 11.1206C6.92144 11.6316 7.45948 11.9119 8.00022 11.9119C8.60048 11.9119 9.14177 11.6135 9.62857 11.0603C9.64978 11.0362 9.668 11.0093 9.68884 10.9844C9.70979 10.8346 9.74611 10.6809 9.79821 10.5246C10.0962 9.63065 10.4155 9.01719 10.6777 8.67975C10.7435 8.59502 10.8246 8.50399 10.9187 8.42863C10.9654 8.39132 11.0355 8.34117 11.1263 8.30252C11.2104 8.26678 11.3781 8.21243 11.5828 8.25899C11.8212 8.31322 11.9831 8.47406 12.0661 8.63957C12.1369 8.78094 12.146 8.91353 12.1464 8.98555C12.1472 9.13229 12.1103 9.26699 12.0795 9.35944C11.842 10.0719 11.5029 10.8098 11.056 11.4521C11.1037 11.7492 11.2915 12.0161 11.6096 12.2322C12.1156 12.5758 12.8539 12.7069 13.498 12.4922C13.8572 12.3727 14.2455 12.5672 14.3652 12.9264C14.4847 13.2856 14.2902 13.6739 13.931 13.7936C12.861 14.1501 11.6804 13.9382 10.8395 13.3672C10.5235 13.1526 10.2447 12.876 10.0382 12.5525C9.47539 12.9908 8.79588 13.2835 8.00022 13.2835C6.99259 13.2835 6.15047 12.8011 5.48125 12.0949C4.60213 12.9324 3.65263 13.694 2.63862 14.3025C2.31393 14.4972 1.8926 14.3917 1.69777 14.067C1.50304 13.7423 1.60861 13.321 1.93326 13.1262C2.89832 12.547 3.80998 11.8073 4.65871 10.9844C4.461 10.6457 4.28987 10.2908 4.14866 9.93421C3.46545 8.20889 3.27469 6.05509 3.94219 4.50787C4.54015 3.12204 5.33818 2.20894 6.23237 1.74895ZM8.22679 2.93868C7.8545 2.73999 7.37541 2.70351 6.8596 2.96881C6.33112 3.24077 5.71591 3.8582 5.20112 5.0514C4.7258 6.15316 4.82081 7.90864 5.42321 9.42975C5.49571 9.61281 5.57352 9.787 5.65536 9.95207C6.77908 8.70669 7.76186 7.3497 8.56384 6.08711C9.53502 4.55807 8.95826 3.32948 8.22679 2.93868Z" fill="currentColor" /></svg></span>
  return <span className="settings-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M6.99953 4.71031C8.26416 4.71034 9.28949 5.73576 9.28959 7.00037C9.28949 8.26499 8.26416 9.29041 6.99953 9.29044C5.73495 9.29034 4.70956 8.26495 4.70946 7.00037C4.70956 5.7358 5.73495 4.71041 6.99953 4.71031ZM6.99953 5.85534C6.36731 5.85544 5.8546 6.36816 5.85449 7.00037C5.8546 7.63259 6.36731 8.14531 6.99953 8.14541C7.6318 8.14538 8.14445 7.63263 8.14456 7.00037C8.14445 6.36812 7.6318 5.85537 6.99953 5.85534Z" fill="currentColor" /><path fillRule="evenodd" clipRule="evenodd" d="M7.13361 0.707409C7.44273 0.729772 7.74185 0.83044 8.00293 1.00012C8.3008 1.19374 8.53639 1.46937 8.68088 1.7939L9.01829 2.54614L9.01891 2.54865L9.04787 2.60657C9.1189 2.73806 9.22465 2.84811 9.35443 2.92383L9.41171 2.95341C9.54754 3.01805 9.69877 3.04463 9.84921 3.02895L10.6675 2.94208L10.801 2.93264C11.1107 2.92244 11.4187 2.99092 11.6961 3.13219C12.0129 3.29355 12.2762 3.54321 12.454 3.85106L12.5163 3.96877C12.6516 4.24756 12.7146 4.55681 12.6983 4.86768C12.6819 5.17855 12.5869 5.47959 12.4232 5.74266L12.3489 5.85282L11.8642 6.51882C11.7626 6.6586 11.7081 6.82756 11.7081 7.00037V7.00289C11.7072 7.17555 11.761 7.34425 11.8617 7.48445L12.3464 8.15044L12.4207 8.2606C12.5844 8.52364 12.6793 8.82473 12.6957 9.13559C12.7144 9.49067 12.6293 9.84366 12.4515 10.1516L12.4521 10.1522C12.2743 10.4603 12.0106 10.7102 11.6936 10.8717C11.4162 11.013 11.1081 11.0814 10.7985 11.0713L10.6656 11.0618L9.84732 10.9743C9.67522 10.9562 9.50184 10.9937 9.35191 11.0801L9.35128 11.0794C9.20331 11.1653 9.08571 11.296 9.01577 11.4521L9.0164 11.4527L8.68151 12.205C8.5371 12.5302 8.30124 12.8067 8.00293 13.0006C7.74189 13.1703 7.44267 13.2703 7.13361 13.2927L7.00078 13.2977C6.64492 13.2978 6.29639 13.1946 5.99801 13.0006C5.73699 12.8309 5.52388 12.598 5.37797 12.3246L5.32006 12.205L4.98517 11.4527C4.92385 11.3148 4.8256 11.196 4.7019 11.1109L4.64714 11.0769C4.49726 10.9905 4.32381 10.9525 4.15173 10.9705L4.15236 10.9712L3.33403 11.0587H3.33277C2.97913 11.0958 2.62231 11.0293 2.30545 10.8679C1.98859 10.7065 1.72483 10.457 1.54692 10.1491L1.54755 10.1484C1.3697 9.84049 1.28463 9.48758 1.30331 9.13244C1.32207 8.77724 1.44334 8.43488 1.65268 8.1473L2.13738 7.4813L2.17326 7.4278C2.24059 7.31781 2.28086 7.19315 2.29098 7.06458L2.29349 7.00037C2.29348 6.84911 2.25187 6.70059 2.17326 6.57232L2.13738 6.51882L1.65268 5.85282C1.44336 5.56518 1.322 5.22294 1.30331 4.86768C1.28467 4.51242 1.36952 4.15906 1.54755 3.85106C1.72536 3.54322 1.98866 3.29353 2.30545 3.13219C2.58286 2.99093 2.89089 2.92242 3.20058 2.93264L3.3334 2.94208L4.15488 3.02895C4.32695 3.04699 4.49976 3.01022 4.64966 2.92383C4.798 2.83724 4.91509 2.70578 4.98454 2.54865L4.98517 2.5474L5.32006 1.79516L5.37797 1.67556C5.52385 1.40234 5.73716 1.16976 5.99801 1.00012C6.29636 0.806229 6.64497 0.702953 7.00078 0.703003L7.13361 0.707409ZM7.00078 1.84741C6.86653 1.84739 6.73504 1.88695 6.62246 1.96009C6.53809 2.01493 6.46674 2.08715 6.41347 2.17159L6.36626 2.26035L6.03138 3.01133L6.03201 3.01196C5.86461 3.39053 5.58163 3.70664 5.22375 3.91464L5.22186 3.91527C4.90757 4.09655 4.55019 4.18696 4.1895 4.17776L4.03465 4.16769L3.21254 4.08019C3.0792 4.06618 2.94427 4.09113 2.82478 4.15195C2.70521 4.21287 2.60608 4.30768 2.53899 4.42389C2.47186 4.54003 2.43945 4.67392 2.44646 4.80788C2.45355 4.94172 2.49918 5.07088 2.57802 5.17927L3.06272 5.84527L3.14959 5.97431C3.33818 6.28213 3.43856 6.63738 3.43853 7.00037L3.43223 7.15523C3.40377 7.515 3.27672 7.86131 3.06335 8.15485L2.57802 8.82085C2.49908 8.9293 2.45354 9.05892 2.44646 9.19287C2.44119 9.29335 2.45794 9.39349 2.49493 9.48621L2.53836 9.57623L2.59502 9.65932C2.65692 9.7377 2.7351 9.80246 2.82478 9.84817C2.94429 9.90904 3.07915 9.9338 3.21254 9.91993L4.0315 9.83306L4.03213 9.83243L4.18698 9.82236C4.54763 9.81313 4.90509 9.90362 5.21934 10.0849L5.3509 10.1679C5.64817 10.3725 5.88407 10.6559 6.03138 10.9875L6.36626 11.7398L6.41347 11.8285C6.46676 11.9131 6.538 11.9858 6.62246 12.0407C6.73503 12.1138 6.86655 12.1527 7.00078 12.1527L7.10087 12.1452C7.19965 12.1308 7.29474 12.0955 7.37911 12.0407C7.49164 11.9675 7.58082 11.8631 7.63531 11.7404L7.97019 10.9875L8.03881 10.8484C8.21049 10.533 8.46598 10.2696 8.77845 10.0886L8.77971 10.088L8.91694 10.0162C9.24278 9.86116 9.60605 9.79831 9.96692 9.83621L10.7865 9.92308C10.92 9.93719 11.0546 9.91225 11.1743 9.85131C11.2937 9.79041 11.393 9.6961 11.4601 9.58001L11.5041 9.48936C11.5411 9.39666 11.5579 9.29646 11.5526 9.19602C11.5473 9.09561 11.5197 8.99789 11.4733 8.9096L11.4204 8.82462L10.9357 8.158L10.9344 8.15674C10.6909 7.8195 10.561 7.41323 10.563 6.99723C10.5637 6.58343 10.6948 6.17999 10.9382 5.84527L11.4229 5.17927L11.4764 5.09429C11.5228 5.00607 11.5498 4.9082 11.5551 4.80788C11.5604 4.70749 11.5435 4.60735 11.5066 4.51454L11.4632 4.42389C11.3961 4.30768 11.2963 4.21288 11.1768 4.15195C11.0572 4.09104 10.9219 4.06546 10.7884 4.07956L10.789 4.08019L9.97007 4.16769C9.5576 4.211 9.14149 4.12248 8.78223 3.91527L8.78034 3.91464C8.4224 3.70665 8.1395 3.39057 7.97208 3.01196L7.63594 2.26161L7.63531 2.26035C7.58081 2.1377 7.49163 2.03325 7.37911 1.96009C7.2947 1.90523 7.1997 1.86935 7.10087 1.85496L7.00078 1.84741Z" fill="currentColor" /></svg></span>
}

function resolveSection(section: string): Section {
  return SECTIONS.includes(section as Section) ? section as Section : 'settings'
}

export function SettingsPanel({ section: initialSection = 'settings', onSectionChange }: {
  section?: string
  onSectionChange?: (section: Section) => void
}) {
  const t = useSettingsText()
  const [section, setSection] = useState<Section>(() => resolveSection(initialSection))
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSection(resolveSection(initialSection))
  }, [initialSection])
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [section])
  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings navigation"><div className="settings-nav-brand"><BrandLockup /><small>PREFERENCES</small></div>
        {SECTIONS.map((id) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined}
          className={`settings-nav-item ${section === id ? 'is-selected' : ''}`}
          onClick={() => { setSection(id); onSectionChange?.(id) }}>
          <NavigationIcon section={id} />
          <span>{t(TITLES[id].text, TITLES[id].key)}</span>
        </button>)}
      </nav>
      <div ref={contentRef} className="settings-content">
        <h1 className={`settings-title ${section !== 'settings' ? 'settings-title-secondary' : ''}`}>{t(TITLES[section].text, TITLES[section].key)}{section === 'writing' && <span className="settings-info" title={t("Sayrel learns your unique writing style and tone and adapts how your dictation is phrased.")}>ⓘ</span>}</h1>
        {section === 'settings' && <div className="settings-groups">
          <Group title="System permissions" icon="permissions"><SettingsPermissions /></Group>
          <Group title="Shortcuts" icon="shortcuts"><DictationSection /></Group>
          <Group title="Language" icon="language"><LanguageSection autoOpenTranslation={initialSection === 'translation'} /></Group>
          <Group title="Audio" icon="audio"><AudioSection autoOpen={initialSection === 'microphone'} /></Group>
          <Group title="General" icon="general"><GeneralSection /></Group>
        </div>}
        {section === 'writing' && <PersonalizationSection />}
        {section === 'about' && <AboutSection />}
        {section === 'help' && <HelpSection />}
      </div>
    </div>
  )
}

function Group({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const t = useSettingsText()
  return <section className="settings-group"><h2 className="settings-group-title"><CategoryIcon name={icon} />{t(title)}</h2>{children}</section>
}

function LanguageSection({ autoOpenTranslation }: { autoOpenTranslation: boolean }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  return <>
    <Row label="Interface language" hint="Choose the language used in the user interface.">
      <HubSelect label={t("Interface language")} value={settings.language ?? 'en'} options={interfaceLanguages} onChange={async value => { await api.i18n.setLanguage(value); await patch({ language: value }) }} />
    </Row>
    <Row label="Translation targets" hint="Choose up to 3 target languages for your dictation in translation mode."><TranslationTargets autoOpen={autoOpenTranslation} /></Row>
    <Row label="Language variants" hint="Choose your preferred language variants for the best experience."><LanguageVariants /></Row>
  </>
}

function GeneralSection() {
  const { settings, patch } = useAppSettings()
  return (
    <>
      <Row label="Appearance" hint="Choose between light and dark modes.">
        <Choice
          value={settings.appearancePreference}
          options={[
            { value: 'system', label: "System" },
            { value: 'light', label: "Light" },
            { value: 'dark', label: "Dark" }
          ]}
          onChange={(v) => {
            void patch({ appearancePreference: v as any })
            void api.appearance.setPreference(v)
          }}
        />
      </Row>
      <Row label="Launch at startup" hint="Open Sayrel automatically when your computer starts.">
        <Toggle
          value={settings.launchAtLogin}
          onChange={(v) => {
            void patch({ launchAtLogin: v })
            void api.permission.updateAutoLaunch(v)
          }}
        />
      </Row>
      <Row label="Show app in dock" hint="Display Sayrel in your Mac dock for quick access.">
        <Toggle
          value={settings.showInDock}
          onChange={(v) => {
            void patch({ showInDock: v })
            void api.app.setDock?.(v)
          }}
        />
      </Row>
    </>
  )
}

function DictationSection() {
  return <>
    <Row label="Dictate" hint="Press to start and stop dictation."><ShortcutEditor settingKey="shortcut" /></Row>
    <Row label="Translate" hint="Press to start and stop translation."><ShortcutEditor settingKey="translationShortcut" /></Row>
    <Row label="Ask anything" hint="Press to start and stop asking anything."><ShortcutEditor settingKey="askAnythingShortcut" /></Row>
  </>
}

function AudioSection({ autoOpen }: { autoOpen: boolean }) {
  const { settings, patch } = useAppSettings()
  return <>
    <Row label="Microphone" hint="Choose your preferred microphone for Sayrel to capture your voice."><MicrophonePicker autoOpen={autoOpen} /></Row>
    <Row label="Interaction sounds" hint="Play sounds for key actions like start/stop."><Toggle value={settings.playSoundOnRecord} onChange={value => void patch({ playSoundOnRecord: value })} /></Row>
    <Row label="Mute when dictating" hint="Automatically silence other active audio during dictation."><Toggle value={settings.muteWhileDictating} onChange={value => void patch({ muteWhileDictating: value })} /></Row>
  </>
}

function PersonalizationSection() {
  const t = useSettingsText()
  return <><div className="settings-personal-card"><div className="settings-personal-heading"><span>{t("Overall personalization:")}</span><strong>--</strong><button className="settings-pill" disabled title="Personalization is not available yet">{t("Enable personalization")}</button></div><div className="settings-personal-empty"><div className="settings-personal-chart" /><span>{t("Not Enough Data")}</span></div></div></>
}

function ExternalRow({ label, url }: { label: string; url: string }) {
  const t = useSettingsText()
  return <button className="settings-link-row" onClick={() => void api.page.openUrl(url)}><span>{t(label)}</span><ArrowOutward /></button>
}

function HelpSection() {
  const t = useSettingsText()
  const openTour = useFeatureTour()
  const { settings } = useAppSettings()
  const [opening, setOpening] = useState(false)
  const reopenSetup = async () => {
    setOpening(true)
    try { await api.page.openOnboarding() }
    catch { toast.error('Could not open setup. Please try again.') }
    finally { setOpening(false) }
  }
  return <>
    <Row label="Explore key features" hint="Guided examples for Dictate, Translate, and Ask anything."><button className="settings-pill" onClick={openTour}>{t("Start")}</button></Row>
    <Row label="Initial setup" hint="Review permissions, test your microphone, and try your shortcut."><button type="button" className="settings-pill" disabled={opening} onClick={() => void reopenSetup()}>{t(opening ? 'Opening…' : 'Reopen setup')}</button></Row>
    <ExternalRow label="Help center" url="https://www.typeless.com/help" /><ExternalRow label="Release notes" url={`https://www.typeless.com/help/release-notes/macos?lang=${settings.language ?? 'en'}`} />
  </>
}

function AboutSection() {
  const t = useSettingsText()
  const [version, setVersion] = useState('')
  useEffect(() => { api.app.systemInfo().then((info: { appVersion?: string }) => { if (info?.appVersion) setVersion(info.appVersion) }).catch(() => undefined) }, [])
  const [checking, setChecking] = useState(false)
  return <><Row label="Version" hint={version ? `v${version}` : '—'}><button className="settings-pill" disabled={checking} onClick={async () => {
    setChecking(true)
    try { await checkForUpdates(version) } finally { setChecking(false) }
  }}>{t(checking ? "Checking for updates..." : "Check for updates")}</button></Row><Row label="Typography" hint="This app uses MiSans fonts."><button className="settings-pill" onClick={() => void api.page.openUrl('https://hyperos.mi.com/font/zh/download/')}>{t("Font license")}</button></Row><ExternalRow label="Privacy Policy" url="https://www.typeless.com/privacy" /><ExternalRow label="Terms of Service" url="https://www.typeless.com/terms" /></>
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const t = useSettingsText()
  return <div className="settings-row"><div className="settings-row-copy"><p className="settings-row-label">{t(label)}</p>{hint && <p className="settings-row-hint">{t(hint)}</p>}</div><div className="settings-row-control">{children}</div></div>
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!value)} role="switch" aria-checked={value} className={`settings-toggle ${value ? 'is-on' : ''}`}><span /></button>
}

function Choice({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const t = useSettingsText()
  return <HubSelect label={t("Appearance")} value={value} options={options.map(option => ({ ...option, label: t(option.label) }))} onChange={onChange} />
}

