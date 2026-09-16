import { RENDER_PACKAGE_NAME } from '@infinite-table/render';

// 表格主体公共入口（骨架：ListTable/状态机/布局/主题在后续阶段落地）
export const CORE_PACKAGE_NAME = '@infinite-table/core';

// 依赖边占位：core → render
export const CORE_DEPENDENCY_CHAIN = `${CORE_PACKAGE_NAME} -> ${RENDER_PACKAGE_NAME}`;
