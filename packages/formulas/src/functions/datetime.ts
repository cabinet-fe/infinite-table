// 日期与时间函数集：TODAY / NOW（易失性）。
// 返回 1900 系统序列数（本地时间，含 Lotus 伪闰日修正；整数日为当日 0 点，小数部分为日内时间）。

import { registerFormulaFunction } from './registry'

/** 本地时间 → 1900 系统序列数（serial 60 = 伪 1900-02-29：1900-03-01 起的日期序列 = 天数差本身） */
function localDateToSerial1900(date: Date): number {
  const days =
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) /
    86_400_000
  const serial = days >= 61 ? days : days - 1
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return serial + (date.getTime() - midnight) / 86_400_000
}

registerFormulaFunction('TODAY', {
  volatile: true,
  minArgs: 0,
  maxArgs: 0,
  meta: {
    params: [],
    description: '返回当天日期的序列数',
    category: '日期与时间',
  },
  impl: () => Math.floor(localDateToSerial1900(new Date())),
})

registerFormulaFunction('NOW', {
  volatile: true,
  minArgs: 0,
  maxArgs: 0,
  meta: {
    params: [],
    description: '返回当前日期时间的序列数（含时间小数部分）',
    category: '日期与时间',
  },
  impl: () => localDateToSerial1900(new Date()),
})
