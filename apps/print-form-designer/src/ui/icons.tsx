// 图标集：全部手写内联 SVG（24 viewBox / stroke 1.75 / currentColor），不引第三方图标包。
// 统一 16px 渲染尺寸，随按钮字号/颜色继承；aria-hidden 交由外层按钮 title 承担语义。
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 品牌标记：叠层单据 */
export function IconBrand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M16 7h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Svg>
  )
}

export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10h10a5 5 0 0 1 0 10h-3" />
      <path d="m7 6-4 4 4 4" />
    </Svg>
  )
}

export function IconRedo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 10H11a5 5 0 0 0 0 10h3" />
      <path d="m17 6 4 4-4 4" />
    </Svg>
  )
}

export function IconPrint(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9V4h12v5" />
      <path d="M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" />
      <path d="M6 14h12v6H6z" />
    </Svg>
  )
}

export function IconBold(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </Svg>
  )
}

export function IconAlignLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h10M4 18h14" />
    </Svg>
  )
}

export function IconAlignCenter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M7 12h10M5 18h14" />
    </Svg>
  )
}

export function IconAlignRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M10 12h10M6 18h14" />
    </Svg>
  )
}

export function IconAlignTop(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16" />
      <path d="M12 8v12" />
      <path d="m8 11 4-3 4 3" />
    </Svg>
  )
}

export function IconAlignMiddle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
      <path d="M12 4v5M12 15v5" />
      <path d="m9 6 3-2 3 2M9 18l3 2 3-2" />
    </Svg>
  )
}

export function IconAlignBottom(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h16" />
      <path d="M12 4v12" />
      <path d="m8 13 4 3 4-3" />
    </Svg>
  )
}

export function IconMerge(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="18" height="10" rx="1.5" />
      <path d="M9 7v10M15 7v10" />
      <path d="M3 12h18" strokeDasharray="2 2.5" />
    </Svg>
  )
}

export function IconSplit(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="7" height="10" rx="1.2" />
      <rect x="14" y="7" width="7" height="10" rx="1.2" />
    </Svg>
  )
}

export function IconEraser(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 15 6-6 6 6-4 4H8z" />
      <path d="M11 20h9" />
    </Svg>
  )
}

export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function IconChevronUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </Svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="m13.5 7.5 3 3" />
    </Svg>
  )
}

export function IconDataSource(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Svg>
  )
}

export function IconDataset(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M9 9.5V20" />
    </Svg>
  )
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </Svg>
  )
}

export function IconDatabase(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h4M7 12h10M7 16h7" />
    </Svg>
  )
}

export function IconFunction(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 4h-2a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H5" />
      <path d="M8 11h7" />
      <path d="M14 14.5 19 20M19 14.5 14 20" />
    </Svg>
  )
}
