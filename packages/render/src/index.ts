import { UTILS_PACKAGE_NAME } from '@infinite-table/utils';

// 自研 canvas 渲染引擎公共入口（骨架：场景树/分层/失效/事件/池化在后续阶段落地）
export const RENDER_PACKAGE_NAME = '@infinite-table/render';

// 依赖边占位：render → utils
export const RENDER_DEPENDENCY_CHAIN = `${RENDER_PACKAGE_NAME} -> ${UTILS_PACKAGE_NAME}`;
