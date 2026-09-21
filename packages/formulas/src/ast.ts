// 公式 AST 节点。引用节点携带可选 sheet 名（跨表引用）；缺省 = 公式所在表（宿主决定）。

import type { CellRef, RangeRef } from './address'
import type { FormulaErrorCode } from './errors'

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '&'
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='

export type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  /** 错误字面量（如 #DIV/0!）；求值为对应错误值 */
  | { kind: 'error'; code: FormulaErrorCode }
  /** 未知名称（如裸写的 Sheet2 / 未定义命名）；求值为 #NAME? */
  | { kind: 'name'; name: string }
  | { kind: 'cell'; ref: CellRef }
  | { kind: 'range'; ref: RangeRef }
  | { kind: 'unary'; op: '-' | '+'; operand: AstNode }
  /** 百分号后缀运算（除以 100） */
  | { kind: 'percent'; operand: AstNode }
  | { kind: 'binary'; op: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }
