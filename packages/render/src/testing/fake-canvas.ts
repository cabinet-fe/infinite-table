// 测试共享的假 canvas/2d 上下文：记录调用、可控测量，供 node 环境下的单测注入
import type { RenderCanvas, RenderContext } from '../types';

export interface RecordedCall {
  name: string;
  args: unknown[];
}

export class FakeContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  lineWidth = 1;
  font = '';
  readonly calls: RecordedCall[] = [];

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }

  callsOf(name: string): RecordedCall[] {
    return this.calls.filter((call) => call.name === name);
  }

  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  setTransform(...args: unknown[]): void {
    this.record('setTransform', ...args);
  }
  translate(x: number, y: number): void {
    this.record('translate', x, y);
  }
  beginPath(): void {
    this.record('beginPath');
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.record('rect', x, y, width, height);
  }
  clip(): void {
    this.record('clip');
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.record('clearRect', x, y, width, height);
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', x, y, width, height);
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', text, x, y);
  }
  drawImage(...args: unknown[]): void {
    this.record('drawImage', ...args);
  }
  measureText(text: string): {
    width: number;
    actualBoundingBoxAscent: number;
    actualBoundingBoxDescent: number;
  } {
    return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
  }
}

export class FakeCanvas implements RenderCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeContext();

  getContext(_contextId: '2d'): RenderContext | null {
    return this.context;
  }
}

export function createFakeCanvas(): RenderCanvas {
  return new FakeCanvas();
}
