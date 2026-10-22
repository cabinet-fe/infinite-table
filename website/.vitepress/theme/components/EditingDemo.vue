<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { EditorRegistry, SheetModel } from '@infinitable/table'
import { useDemoTable } from '../demo/use-demo-table'

const HEIGHT = 320
const ROW_COUNT = 200

const model = new SheetModel(ROW_COUNT, 3)
for (let row = 0; row < ROW_COUNT; row += 1) {
  model.setCellValue(0, row, `项目 ${row + 1}`)
  model.setCellValue(1, row, (row % 20) + 1)
  model.setCellValue(2, row, row % 3 === 0 ? '待复核' : '已确认')
}

const editorRegistry = new EditorRegistry()
editorRegistry.registerEditor('text', { name: 'text' })
editorRegistry.registerEditor('number', { name: 'number' })

const changes = ref<string[]>([])

const { container, table } = useDemoTable(
  (width) => ({
    columns: [
      { title: '名称（只读）', width: 180, editor: 'text' },
      { title: '数量', width: 100, editor: 'number' },
      {
        title: '备注',
        width: Math.max(160, width - 56 - 280),
        editor: 'text',
        editorMultiline: true,
      },
    ],
    model,
    editorRegistry,
    editCellOnEnter: true,
    editorInsideBorder: true,
    resolveEditable: (col) => col > 0,
  }),
  HEIGHT,
)

onMounted(() => {
  table.value?.onCellChange((change) => {
    changes.value = [
      `第 ${change.row + 1} 行第 ${change.col + 1} 列：${String(change.oldValue ?? '空')} → ${String(change.newValue ?? '空')}`,
      ...changes.value,
    ].slice(0, 5)
  })
})

function editQuantity(): void {
  table.value?.startEdit(1, 0)
}

function commit(): void {
  table.value?.commitEdit()
}

function cancel(): void {
  table.value?.cancelEdit()
}
</script>

<template>
  <div class="demo-frame">
    <div class="demo-toolbar">
      <strong>实时示例</strong>
      <span>双击单元格或按 Enter 进入编辑；第一列只读</span>
      <button type="button" @click="editQuantity">编辑第 1 行数量</button>
      <button type="button" @click="commit">提交</button>
      <button type="button" @click="cancel">取消</button>
    </div>
    <div class="demo-meta">
      <template v-if="changes.length">最近变更：{{ changes[0] }}</template>
      <template v-else>编辑后这里会显示 onCellChange 事件</template>
    </div>
    <div ref="container" class="demo-canvas" :style="{ height: `${HEIGHT}px` }" />
  </div>
</template>
