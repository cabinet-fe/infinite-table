// 图片与浮动对象演示：格内图片走 L2 media 层（ImageService 窗口化加载 + 位图 LRU + 无闪协议），
// FloatObjectLayer 承载格上浮动图片、随滚动帧级跟随。
// 加载器注入本地生成的彩色位图（40ms 人工延迟），零网络、可重复。
// 第二个浮动对象演示缩放/旋转（univer Transformer 思路：选中后 8 缩放手柄 + 顶部旋转手柄，
// Shift 等比/15° 吸附，初始 45°）：变换结束经 onTransformEnd 写回示例模型并实时显示新状态。

import {
  addButton,
  addStatus,
  createSection,
  demoLoadImage,
  mountTable,
  type DemoMount,
} from '../mount'

export const MEDIA_COL_COUNT = 6
export const MEDIA_ROW_COUNT = 500

/** 图片格规则：第 1 列偶数行；URL 为本地伪协议（由注入的 loadImage 生成位图） */
export function imageUrlForRow(row: number): string {
  return `demo://img/${row}`
}

export const FLOAT_OBJECT_ID = 'float-1'
export const FLOAT_IMAGE_URL = 'demo://float/main'

/** 缩放/旋转演示对象：固定演示图 + 初始 45°（可复现） */
export const TRANSFORM_OBJECT_ID = 'float-transform'
export const TRANSFORM_IMAGE_URL = 'demo://float/transform'
export const TRANSFORM_INITIAL = {
  anchor: { from: { col: 0, row: 6 }, to: { col: 1, row: 7 }, offsetX: 16, offsetY: 16 },
  size: { width: 180, height: 120 },
  rotation: 45,
}

export interface MediaDemo {
  mount: DemoMount
}

export function mountMedia(root: HTMLElement): MediaDemo {
  const section = createSection(
    root,
    '图片与浮动对象',
    '第 1 列偶数行为格内图片（L2 media 层 + 窗口化加载 + 位图 LRU，滚动来回无闪）；' +
      '一个浮动图片对象锚在 (2,1)~(4,3) 随滚动跟随；' +
      '另一个 45° 浮动图片可选中后拖角/边手柄缩放（Shift 等比）、拖顶部手柄旋转（Shift 吸附 15°）。',
  )

  const mount: DemoMount = mountTable(section, {
    width: 720,
    height: 320,
    columns: Array.from({ length: MEDIA_COL_COUNT }, (_, col) => ({
      title: `列${col}`,
      width: 100,
    })),
    rowCount: MEDIA_ROW_COUNT,
    resolveDisplayValue: (col, row) => `m-${col}-${row}`,
    resolveCellImage: (col, row) => (col === 1 && row % 2 === 0 ? imageUrlForRow(row) : null),
    imageServiceOptions: { loadImage: demoLoadImage },
  })
  const { table } = mount

  let loadedCount = 0
  const status = addStatus(section, '图片已加载 0 张')
  table.imageService.onImageLoad(() => {
    loadedCount++
    status.textContent = `图片已加载 ${loadedCount} 张`
  })
  table.imageService.onImageError((event) => {
    status.textContent = `图片加载失败：${event.url}`
  })

  const addFloat = () => {
    table.floatObjects.add({
      id: FLOAT_OBJECT_ID,
      kind: 'image',
      anchor: { from: { col: 2, row: 1 }, to: { col: 4, row: 3 }, offsetX: 8, offsetY: 8 },
      src: FLOAT_IMAGE_URL,
      title: '浮动图片',
    })
  }
  addFloat()
  addButton(section, '移除/重建浮动对象', () => {
    if (table.floatObjects.get(FLOAT_OBJECT_ID)) {
      table.floatObjects.remove(FLOAT_OBJECT_ID)
    } else {
      addFloat()
    }
  })

  // ---- 缩放/旋转演示：固定图 + 初始 45°，变换结束写回示例模型并显示新状态 ----
  const transformModel = {
    anchor: {
      from: { ...TRANSFORM_INITIAL.anchor.from },
      to: { ...TRANSFORM_INITIAL.anchor.to },
      offsetX: TRANSFORM_INITIAL.anchor.offsetX,
      offsetY: TRANSFORM_INITIAL.anchor.offsetY,
    },
    size: { ...TRANSFORM_INITIAL.size },
    rotation: TRANSFORM_INITIAL.rotation,
  }
  const transformStatus = addStatus(
    section,
    `变换对象：${TRANSFORM_INITIAL.size.width}×${TRANSFORM_INITIAL.size.height} · ${TRANSFORM_INITIAL.rotation}°`,
  )
  table.floatObjects.add({
    id: TRANSFORM_OBJECT_ID,
    kind: 'image',
    anchor: transformModel.anchor,
    size: transformModel.size,
    rotation: transformModel.rotation,
    src: TRANSFORM_IMAGE_URL,
    title: '可缩放旋转图片',
  })
  table.floatObjects.onTransformEnd((event) => {
    // 宿主写回路径：事件载荷写回示例模型并同步渲染（拖拽过程只改渲染态，这里才提交）
    transformModel.anchor = event.anchor
    transformModel.size = event.size
    transformModel.rotation = event.rotation
    table.floatObjects.update(event.id, {
      anchor: event.anchor,
      size: event.size,
      rotation: event.rotation,
    })
    transformStatus.textContent = `变换对象：${event.size.width}×${event.size.height} · ${Math.round(event.rotation)}°`
  })

  return { mount }
}
