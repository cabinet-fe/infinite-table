<script setup lang="ts">
import { computed, ref } from 'vue'
import { evaluate, type FormulaResolver, type RangeRef } from '@infinitable/formulas'

const grid: number[][] = [
  [10, 20, 30],
  [5, 15, 25],
  [2, 4, 6],
  [1, 3, 5],
]

const resolver: FormulaResolver = {
  cell: (ref) => grid[ref.row]?.[ref.col],
  range: (ref: RangeRef) => {
    const values: number[] = []
    for (let row = ref.startRow; row <= ref.endRow; row += 1) {
      for (let col = ref.startCol; col <= ref.endCol; col += 1) {
        const value = grid[row]?.[col]
        if (value !== undefined) {
          values.push(value)
        }
      }
    }
    return values
  },
}

const formula = ref('=SUM(A1:A4)')
const samples = [
  '=SUM(A1:A4)',
  '=AVERAGE(B1:B4)',
  '=MAX(A1:C4) - MIN(A1:C4)',
  '=ROUND(AVERAGE(C1:C4), 1)',
]

const result = computed(() => {
  const text = formula.value.trim().replace(/^=/, '')
  if (!text) {
    return '请输入公式'
  }
  const value = evaluate(text, resolver)
  return typeof value === 'object' ? `${value.code}` : String(value)
})
</script>

<template>
  <div class="demo-frame formula-demo">
    <div class="demo-toolbar">
      <strong>公式试算</strong>
      <span>数据区 A1:C4，求值由宿主 resolver 提供</span>
    </div>
    <div class="formula-grid">
      <div class="formula-cells">
        <div class="formula-corner" />
        <div v-for="col in ['A', 'B', 'C']" :key="`h-${col}`" class="formula-head">{{ col }}</div>
        <template v-for="(row, rowIndex) in grid" :key="`r-${rowIndex}`">
          <div class="formula-head">{{ rowIndex + 1 }}</div>
          <div
            v-for="(value, colIndex) in row"
            :key="`c-${rowIndex}-${colIndex}`"
            class="formula-cell"
          >
            {{ value }}
          </div>
        </template>
      </div>
      <div class="formula-input">
        <label>
          公式
          <input v-model="formula" type="text" spellcheck="false" />
        </label>
        <div class="formula-result">
          <span>结果</span>
          <strong>{{ result }}</strong>
        </div>
        <div class="formula-samples">
          <button v-for="sample in samples" :key="sample" type="button" @click="formula = sample">
            {{ sample }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
