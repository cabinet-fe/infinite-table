import {
  SceneNode,
  type Invalidation,
  type LayerHandle,
  type RenderImageSource,
} from '@infinite-table/render';
import { describe, expect, it } from 'vitest';

import { ImageService, type LoadedImage } from '../media/image-service';
import type { FloatGeometry, FloatObject } from './float-object-layer';
import { FloatObjectLayer } from './float-object-layer';

/** 记录失效的假层 */
function stubLayer() {
  const invalidated: Invalidation[] = [];
  const root = new SceneNode({ pickable: false });
  const layer: LayerHandle = {
    kind: 'sky',
    root,
    canvasElement: { width: 0, height: 0, getContext: () => null },
    setSize: () => {},
    invalidate: (inv) => invalidated.push(inv),
    translateBy: () => {},
  };
  return { layer, root, invalidated };
}

/** 等行高列宽的假几何：格 100x32，scroll 由闭包变量驱动（模拟滚动跟随） */
function stubGeometry(scroll: { left: number; top: number }): FloatGeometry {
  return {
    cellOrigin: (col, row) => ({ x: col * 100 - scroll.left, y: row * 32 - scroll.top }),
    cellSize: () => ({ width: 100, height: 32 }),
  };
}

function imageObject(id: string, from: { col: number; row: number }): FloatObject {
  return {
    id,
    kind: 'image',
    anchor: { from, to: { col: from.col + 1, row: from.row + 1 }, offsetX: 4, offsetY: 8 },
    src: `${id}.png`,
  };
}

describe('FloatObjectLayer 承载与定位', () => {
  it('add：按锚点 from+偏移定位，尺寸由 from→to 格范围决定；size 优先', () => {
    const { layer } = stubLayer();
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) });
    floats.add(imageObject('a', { col: 1, row: 2 }));
    // x = 100+4, y = 64+8；宽到 col2 右缘 300-104=196，高到 row3 底 128-72=56
    const node = layer.root.children[0]?.children[0];
    expect({ x: node?.x, y: node?.y, width: node?.width, height: node?.height }).toEqual({
      x: 104,
      y: 72,
      width: 196,
      height: 56,
    });

    floats.add({ ...imageObject('b', { col: 0, row: 0 }), size: { width: 40, height: 24 } });
    const b = layer.root.children[0]?.children[1];
    expect({ width: b?.width, height: b?.height }).toEqual({ width: 40, height: 24 });
  });

  it('syncPositions：滚动后锚点重算，位置帧级跟随', () => {
    const { layer, invalidated } = stubLayer();
    const scroll = { left: 0, top: 0 };
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry(scroll) });
    floats.add(imageObject('a', { col: 1, row: 2 }));
    scroll.left = 50;
    scroll.top = 32;
    floats.syncPositions();
    const node = layer.root.children[0]?.children[0];
    expect({ x: node?.x, y: node?.y }).toEqual({ x: 54, y: 40 });
    expect(invalidated.at(-1)).toEqual({ type: 'full' });
  });

  it('update 合并 patch 并重排（双包围盒失效）；remove 移除节点', () => {
    const { layer, invalidated } = stubLayer();
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) });
    floats.add(imageObject('a', { col: 0, row: 0 }));
    invalidated.length = 0;
    floats.update('a', {
      anchor: { from: { col: 2, row: 1 }, to: { col: 3, row: 2 }, offsetX: 0, offsetY: 0 },
    });
    const node = layer.root.children[0]?.children[0];
    expect({ x: node?.x, y: node?.y }).toEqual({ x: 200, y: 32 });
    expect(invalidated[0]?.type).toBe('cell');
    expect(invalidated[0]).toMatchObject({ prevRegion: { x: 4, y: 8 } });

    floats.remove('a');
    expect(layer.root.children[0]?.children).toHaveLength(0);
    expect(floats.get('a')).toBeUndefined();
  });

  it('getAt：后加的对象在上，倒序命中', () => {
    const { layer } = stubLayer();
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) });
    floats.add(imageObject('under', { col: 0, row: 0 }));
    floats.add(imageObject('over', { col: 0, row: 0 }));
    expect(floats.getAt(10, 10)?.id).toBe('over');
    expect(floats.getAt(10_000, 10_000)).toBeNull();
  });

  it('onChange：增删改事件按序抛出（供宿主 undo 入库）', () => {
    const { layer } = stubLayer();
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) });
    const events: string[] = [];
    floats.onChange((change) => events.push(change.type));
    floats.add(imageObject('a', { col: 0, row: 0 }));
    floats.update('a', { alt: 'x' });
    floats.remove('a');
    expect(events).toEqual(['add', 'update', 'remove']);
  });

  it('图片对象经 ImageService 加载：未就绪画占位，加载完成定向失效并持有位图', async () => {
    const { layer, invalidated } = stubLayer();
    const image = (url: string): LoadedImage => ({
      source: { url } as unknown as RenderImageSource,
      width: 10,
      height: 10,
    });
    const service = new ImageService({ loadImage: (url) => Promise.resolve(image(url)) });
    const floats = new FloatObjectLayer({
      layer,
      geometry: stubGeometry({ left: 0, top: 0 }),
      imageService: service,
    });
    floats.add(imageObject('a', { col: 0, row: 0 }));
    expect(service.hasResource('a.png')).toBe(false);
    invalidated.length = 0;
    await Promise.resolve();
    await Promise.resolve();
    expect(service.hasResource('a.png')).toBe(true);
    // 加载完成 → cell 定向失效（非整层）
    expect(invalidated).toEqual([{ type: 'cell', region: { x: 4, y: 8, width: 196, height: 56 } }]);
  });

  it('dispose：容器脱离场景树，幂等', () => {
    const { layer, root } = stubLayer();
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) });
    floats.add(imageObject('a', { col: 0, row: 0 }));
    floats.dispose();
    expect(root.children).toHaveLength(0);
    floats.dispose();
  });
});
