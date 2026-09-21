// AST 静态引用收集：纯语法遍历，不调用任何函数语义。
// lazy 求值的函数（如 IF 未命中分支）其参数引用也会被收集——依赖图按「可能读」建边，
// 宁多勿漏（漏边会丢重算，多边只是多标脏）。

import type { CellRef, RangeRef } from './address'
import type { AstNode } from './ast'
import { isVolatileFormulaFunction } from './functions/registry'

/** AST 中出现的引用（cell 或 range；sheet 缺省 = 公式所在表，归一是宿主职责） */
export type AstReference = { kind: 'cell'; ref: CellRef } | { kind: 'range'; ref: RangeRef }

/** 遍历 AST 收集全部引用（含 call args / unary / percent / binary 操作数） */
export function collectAstReferences(node: AstNode): AstReference[] {
  const refs: AstReference[] = []
  walk(node, refs)
  return refs
}

function walk(node: AstNode, refs: AstReference[]): void {
  switch (node.kind) {
    case 'cell':
      refs.push({ kind: 'cell', ref: node.ref })
      return
    case 'range':
      refs.push({ kind: 'range', ref: node.ref })
      return
    case 'unary':
    case 'percent':
      walk(node.operand, refs)
      return
    case 'binary':
      walk(node.left, refs)
      walk(node.right, refs)
      return
    case 'call':
      for (const arg of node.args) {
        walk(arg, refs)
      }
      return
    // number / string / boolean / error / name 无引用
    default:
      return
  }
}

/** AST 是否含易失函数调用（TODAY/NOW/RAND/RANDBETWEEN 等，以注册表 volatile 元数据为准） */
export function astHasVolatileCall(node: AstNode): boolean {
  switch (node.kind) {
    case 'call':
      return isVolatileFormulaFunction(node.name) || node.args.some(astHasVolatileCall)
    case 'unary':
    case 'percent':
      return astHasVolatileCall(node.operand)
    case 'binary':
      return astHasVolatileCall(node.left) || astHasVolatileCall(node.right)
    default:
      return false
  }
}
