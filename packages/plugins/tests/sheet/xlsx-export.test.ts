// xlsx 导出映射单测：合并 / 样式（含边框）/ 行列尺寸 / 浮动图四类保真断言。
// 产物为 hucre WriteSheet 纯数据——断言直接落在映射结果形状上（不落盘、不跑 hucre 写入）。

import { describe, expect, it } from 'vitest'

import type { FloatObject } from '@infinite-table/core'

import { decodeDataUrlImage, sheetToWriteSheet } from '../../src/sheet/xlsx-export'
import { SheetStore } from '../../src/sheet/sheet-store'

const STORE_OPTIONS = {
  rowCount: 8,
  colCount: 6,
  defaultColWidth: 80,
  defaultRowHeight: 28,
} as const

/** 固定字节载荷（imageData 测试替身：按 src 前缀分发） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const imageData = (object: FloatObject) =>
  object.src === 'skip://no-bytes' ? undefined : { data: PNG_BYTES, type: 'png' as const }

describe('sheetToWriteSheet：值与样式保真', () => {
  it('值三类直存 + 公式格进 cells 覆盖表（去 = 前缀、rows 置 null）；显示值经 getDisplayValue 取数', () => {
    const store = new SheetStore({
      ...STORE_OPTIONS,
      resolveDisplayValue: (col, row, value) => (col === 0 && row === 0 ? '显示值' : value),
    })
    store.setValue(0, 0, '原始值')
    store.setValue(1, 0, 42)
    store.setValue(2, 0, true)
    store.setValue(3, 0, '=A1+1')
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.rows![0]).toEqual(['显示值', 42, true, null])
    expect(sheet.cells!.get('0,3')).toEqual({ formula: 'A1+1' })
  })

  it('样式保真：背景/字色/粗体/斜体/下划线/删除线/字号/字族/对齐（middle → center）/换行', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setStyle(0, 0, {
      background: '#ff0000',
      color: '#00ff00',
      fontWeight: 700,
      fontStyle: 'italic',
      underline: true,
      lineThrough: true,
      fontSize: 16,
      fontFamily: 'Arial',
      textAlign: 'center',
      verticalAlign: 'middle',
      textWrap: true,
    })
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.cells!.get('0,0')!.style).toEqual({
      fill: { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'ff0000' } },
      font: {
        color: { rgb: '00ff00' },
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        size: 16,
        name: 'Arial',
      },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    })
  })

  it('边框保真：solid 按宽度收敛 thin/medium/thick；dashed/dotted/double 直传；# 前缀剥离', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setStyle(0, 0, {
      border: {
        top: { width: 1, color: '#111111' },
        right: { width: 2, color: '#222222' },
        bottom: { width: 3, color: '#333333' },
        left: { width: 2, color: '#444444', style: 'dashed' },
      },
    })
    store.setStyle(1, 0, {
      border: { top: { width: 1, color: '#555555', style: 'dotted' } },
    })
    store.setStyle(2, 0, {
      border: { top: { width: 2, color: '#666666', style: 'double' } },
    })
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.cells!.get('0,0')!.style!.border).toEqual({
      top: { style: 'thin', color: { rgb: '111111' } },
      right: { style: 'medium', color: { rgb: '222222' } },
      bottom: { style: 'thick', color: { rgb: '333333' } },
      left: { style: 'dashed', color: { rgb: '444444' } },
    })
    expect(sheet.cells!.get('0,1')!.style!.border).toEqual({
      top: { style: 'dotted', color: { rgb: '555555' } },
    })
    expect(sheet.cells!.get('0,2')!.style!.border).toEqual({
      top: { style: 'double', color: { rgb: '666666' } },
    })
  })

  it('有效样式取数：列级片段合成进导出（getEffectiveStyle 口径，无格级样式的格也带列级字段）', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setColumnStyle(2, { fontWeight: 700, color: '#0000ff' })
    store.setValue(2, 1, 'x')
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.cells!.get('1,2')!.style).toEqual({
      font: { bold: true, color: { rgb: '0000ff' } },
    })
  })

  it('numFmt 查询注入 → Excel 格式码（fixed 两位 / date / thousands / cnUpper）', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setValue(0, 0, 3.14)
    store.setValue(1, 0, 45000)
    store.setValue(2, 0, 1000)
    store.setValue(3, 0, 12)
    const fmts = {
      '0,0': { kind: 'fixed', digits: 2 },
      '1,0': { kind: 'date' },
      '2,0': { kind: 'thousands' },
      '3,0': { kind: 'cnUpper' },
    } as const
    const sheet = sheetToWriteSheet({
      name: 'S',
      store,
      numFmt: (col, row) => fmts[`${col},${row}` as keyof typeof fmts],
    })
    expect(sheet.cells!.get('0,0')!.style!.numFmt).toBe('0.00')
    expect(sheet.cells!.get('0,1')!.style!.numFmt).toBe('yyyy-mm-dd')
    expect(sheet.cells!.get('0,2')!.style!.numFmt).toBe('#,##0.00')
    expect(sheet.cells!.get('0,3')!.style!.numFmt).toBe('[DBNum2][$-804]G/通用格式')
  })
})

describe('sheetToWriteSheet：合并与行列尺寸保真', () => {
  it('合并区坐标直存；空表仅合并区也撑起高水位', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setMerges([{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }])
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.merges).toEqual([{ startRow: 1, startCol: 1, endRow: 2, endCol: 3 }])
    expect(sheet.rows!.length).toBe(3)
    expect(sheet.rows![0]!.length).toBe(4)
  })

  it('行高 px→pt（×0.75）、列宽 px→字符宽（(px-5)/7 取整）；冻结直存', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setRowHeight(2, 40)
    store.setColWidth(1, 120)
    store.setFrozen({ colCount: 1, rowCount: 1 })
    const sheet = sheetToWriteSheet({ name: 'S', store })
    expect(sheet.rowDefs!.get(2)).toEqual({ height: 30 })
    expect(sheet.columns![1]).toEqual({ width: 16 })
    expect(sheet.freezePane).toEqual({ rows: 1, columns: 1 })
  })
})

describe('sheetToWriteSheet：浮动图保真', () => {
  it('无显式尺寸：几何按当前行列尺寸换算（from 原点 + 偏移；尺寸 = from→to 格范围），偏移折入含住格锚', () => {
    const store = new SheetStore(STORE_OPTIONS)
    store.setColWidth(0, 100)
    store.setRowHeight(0, 50)
    // colX = [0,100,180,260,340,420,500]、rowY = [0,50,78,106,134,162,190,218,246]
    const images: FloatObject[] = [
      {
        id: 'img-1',
        kind: 'image',
        anchor: { from: { col: 1, row: 1 }, to: { col: 3, row: 3 }, offsetX: 10, offsetY: 20 },
        src: 'data:image/png;base64,xxx',
        alt: '说明',
        title: '标题',
      },
    ]
    const sheet = sheetToWriteSheet({ name: 'S', store, images, imageData })
    // colX = [0,100,180,260,340,420,500]、rowY = [0,50,78,106,134,162,190,218,246]：
    // 左上角 (110,70) 落 (1,1)；右下角 (340,134)：340 恰为 col 4 左界取 4，134 落 row 4
    expect(sheet.images).toEqual([
      {
        data: PNG_BYTES,
        type: 'png',
        anchor: { from: { row: 1, col: 1 }, to: { row: 4, col: 4 } },
        width: 340 - 110,
        height: 134 - 70,
        altText: '说明',
        title: '标题',
      },
    ])
  })

  it('有显式尺寸：宽高直存不变；to 锚按左上角 + 显式尺寸换算', () => {
    const store = new SheetStore(STORE_OPTIONS)
    const images: FloatObject[] = [
      {
        id: 'img-2',
        kind: 'image',
        anchor: { from: { col: 0, row: 0 }, to: { col: 5, row: 5 }, offsetX: 0, offsetY: 0 },
        size: { width: 120, height: 80 },
        src: 'data:image/png;base64,xxx',
      },
    ]
    const sheet = sheetToWriteSheet({ name: 'S', store, images, imageData })
    // 默认列宽 80：120 落 col 1（80≤120<160）；行高 28：80 落 row 2（56≤80<84）
    expect(sheet.images![0]!.width).toBe(120)
    expect(sheet.images![0]!.height).toBe(80)
    expect(sheet.images![0]!.anchor).toEqual({
      from: { row: 0, col: 0 },
      to: { row: 2, col: 1 },
    })
  })

  it('锚定几何随行列尺寸伸缩（P7 口径）：同一锚在列宽加大后导出更宽', () => {
    const images: FloatObject[] = [
      {
        id: 'img-3',
        kind: 'image',
        anchor: { from: { col: 1, row: 1 }, to: { col: 2, row: 2 }, offsetX: 0, offsetY: 0 },
        src: 'data:image/png;base64,xxx',
      },
    ]
    const before = sheetToWriteSheet({
      name: 'S',
      store: new SheetStore(STORE_OPTIONS),
      images,
      imageData,
    })
    const resized = new SheetStore(STORE_OPTIONS)
    resized.setColWidth(1, 200)
    const after = sheetToWriteSheet({ name: 'S', store: resized, images, imageData })
    // 默认：x=80、宽 = 240-80 = 160；加宽后：x=80、宽 = 360-80 = 280
    expect(before.images![0]!.width).toBe(160)
    expect(after.images![0]!.width).toBe(280)
  })

  it('非 image 类与无字节对象跳过；无浮动图不落 images 字段', () => {
    const store = new SheetStore(STORE_OPTIONS)
    const images: FloatObject[] = [
      {
        id: 'chart',
        kind: 'chart',
        anchor: { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, offsetX: 0, offsetY: 0 },
      },
      {
        id: 'no-bytes',
        kind: 'image',
        anchor: { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, offsetX: 0, offsetY: 0 },
        src: 'skip://no-bytes',
      },
    ]
    const sheet = sheetToWriteSheet({ name: 'S', store, images, imageData })
    expect(sheet.images).toBeUndefined()
    expect(sheetToWriteSheet({ name: 'S', store }).images).toBeUndefined()
  })
})

describe('decodeDataUrlImage', () => {
  it('data: URL → 字节 + 类型；非 data: / 不支持 MIME / 非 base64 返回 undefined', () => {
    const url = `data:image/png;base64,${btoa('abc')}`
    expect(decodeDataUrlImage(url)).toEqual({
      data: new Uint8Array([97, 98, 99]),
      type: 'png',
    })
    expect(decodeDataUrlImage('https://example.com/a.png')).toBeUndefined()
    expect(decodeDataUrlImage('data:image/bmp;base64,AAAA')).toBeUndefined()
    expect(decodeDataUrlImage('data:image/png,urlencoded')).toBeUndefined()
  })
})
