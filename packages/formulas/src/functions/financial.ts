// 财务函数集（等额年金，Excel 符号约定：收入 pv 为正、付出 pmt 为负）：
// PMT / FV / PV / IPMT / PPMT。

import { $n } from '@cat-kit/core'

import { formulaError, isFormulaError, type FormulaError } from '../errors'
import type { EvalValue } from '../evaluator'
import { coerceNumberArgs } from './internal'
import { registerFormulaFunction } from './registry'

/** 每期等额付款额；期数为 0 需除法 → #DIV/0!，结果溢出 → #VALUE! */
function pmtOf(
  rate: number,
  nper: number,
  pv: number,
  fv: number,
  type: boolean,
): number | FormulaError {
  let pmt: number
  if (rate === 0) {
    if (nper === 0) {
      return formulaError('#DIV/0!')
    }
    pmt = $n.div($n.minus(0, $n.plus(pv, fv)), nper)
  } else {
    const factor = Math.pow(1 + rate, nper)
    if (factor === 1) {
      return formulaError('#DIV/0!')
    }
    const owed = $n.plus($n.mul(pv, factor), fv)
    pmt = $n.div($n.mul($n.minus(0, owed), rate), $n.minus(factor, 1))
  }
  const out = type ? $n.div(pmt, 1 + rate) : pmt
  return Number.isFinite(out) ? out : formulaError('#VALUE!')
}

/** 年金终值 FV = -(PV·(1+r)^n + PMT·(1+r·type)·((1+r)^n - 1)/r)；r=0 退化为 -(PV + PMT·n) */
function fvOf(
  rate: number,
  nper: number,
  pmt: number,
  pv: number,
  type: boolean,
): number | FormulaError {
  const factor = Math.pow(1 + rate, nper)
  const accrual = rate === 0 ? nper : (factor - 1) / rate
  const paid = $n.mul($n.mul(pmt, accrual), type ? 1 + rate : 1)
  const out = $n.minus(0, $n.plus($n.mul(pv, factor), paid))
  return Number.isFinite(out) ? out : formulaError('#VALUE!')
}

/** 年金现值 PV = -(FV + PMT·(1+r·type)·((1+r)^n - 1)/r) / (1+r)^n；r=0 退化为 -(FV + PMT·n) */
function pvOf(
  rate: number,
  nper: number,
  pmt: number,
  fv: number,
  type: boolean,
): number | FormulaError {
  const factor = Math.pow(1 + rate, nper)
  if (factor === 0) {
    return formulaError('#DIV/0!')
  }
  const accrual = rate === 0 ? nper : (factor - 1) / rate
  const paid = $n.mul($n.mul(pmt, accrual), type ? 1 + rate : 1)
  const out = $n.div($n.minus(0, $n.plus(fv, paid)), factor)
  return Number.isFinite(out) ? out : formulaError('#VALUE!')
}

/** IPMT / PPMT 共用：参数强转 + per 截断校验（1..nper）+ PMT / 当期利息（错误先行传播） */
function periodParts(args: EvalValue[]): { pmt: number; ipmt: number } | FormulaError {
  const nums = coerceNumberArgs(args, [0, 0, 0, 0, 0, 0])
  if (isFormulaError(nums)) {
    return nums
  }
  const [rate, perRaw, nper, pv, fv, type] = nums as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const per = Math.trunc(perRaw)
  if (per < 1 || per > nper) {
    return formulaError('#VALUE!')
  }
  const due = type !== 0
  const pmt = pmtOf(rate, nper, pv, fv, due)
  if (isFormulaError(pmt)) {
    return pmt
  }
  let ipmt: number
  if (per === 1) {
    // 期初付款第 1 期不产生利息
    ipmt = due ? 0 : $n.mul(-pv, rate)
  } else {
    // 利息 = 期初余额 × rate；余额 = -FV(前 per-1 期，期初付款多抵一期)
    const balance = fvOf(rate, per - 1 - (due ? 1 : 0), pmt, pv, due)
    if (isFormulaError(balance)) {
      return balance
    }
    ipmt = $n.mul(balance, rate)
  }
  return { pmt, ipmt }
}

registerFormulaFunction('PMT', {
  minArgs: 3,
  maxArgs: 5,
  meta: {
    params: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
    description: '基于固定利率的等额分期付款额',
    category: '财务',
  },
  impl(args) {
    const nums = coerceNumberArgs(args, [0, 0, 0, 0, 0])
    if (isFormulaError(nums)) {
      return nums
    }
    const [rate, nper, pv, fv, type] = nums as [number, number, number, number, number]
    return pmtOf(rate, nper, pv, fv, type !== 0)
  },
})

registerFormulaFunction('FV', {
  minArgs: 3,
  maxArgs: 5,
  meta: {
    params: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pmt' },
      { name: 'pv', optional: true },
      { name: 'type', optional: true },
    ],
    description: '基于固定利率与等额分期付款的年金终值',
    category: '财务',
  },
  impl(args) {
    const nums = coerceNumberArgs(args, [0, 0, 0, 0, 0])
    if (isFormulaError(nums)) {
      return nums
    }
    const [rate, nper, pmt, pv, type] = nums as [number, number, number, number, number]
    return fvOf(rate, nper, pmt, pv, type !== 0)
  },
})

registerFormulaFunction('PV', {
  minArgs: 3,
  maxArgs: 5,
  meta: {
    params: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pmt' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
    description: '基于固定利率与等额分期付款的年金现值',
    category: '财务',
  },
  impl(args) {
    const nums = coerceNumberArgs(args, [0, 0, 0, 0, 0])
    if (isFormulaError(nums)) {
      return nums
    }
    const [rate, nper, pmt, fv, type] = nums as [number, number, number, number, number]
    return pvOf(rate, nper, pmt, fv, type !== 0)
  },
})

registerFormulaFunction('IPMT', {
  minArgs: 4,
  maxArgs: 6,
  meta: {
    params: [
      { name: 'rate' },
      { name: 'per' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
    description: '返回某期付款额中的利息部分',
    category: '财务',
  },
  impl(args) {
    const parts = periodParts(args)
    return isFormulaError(parts) ? parts : parts.ipmt
  },
})

registerFormulaFunction('PPMT', {
  minArgs: 4,
  maxArgs: 6,
  meta: {
    params: [
      { name: 'rate' },
      { name: 'per' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
    description: '返回某期付款额中的本金部分',
    category: '财务',
  },
  impl(args) {
    const parts = periodParts(args)
    return isFormulaError(parts) ? parts : $n.minus(parts.pmt, parts.ipmt)
  },
})
