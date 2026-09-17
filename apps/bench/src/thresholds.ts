// 达标阈值：量化基准防回归的达标口径（TTFF 出口、稳态帧率目标、full 重绘次数、单帧失效面积上限）

/** TTFF 固定尺寸 P50 上限（ms）：达标出口 ≤80ms */
export const TTFF_P50_MAX_MS = 80

/** 稳态滚动帧率下限（fps）：目标 ≥55fps 稳态 */
export const SCROLL_FPS_MIN = 55

/** 滚动/交互期间 body 层 full 失效次数上限：要求无全量重绘路径，必须为 0 */
export const BODY_FULL_REPAINT_MAX = 0

/**
 * 每帧 body 失效面积 / 视口面积上限：收敛于单条滚动 band，不随滚动放大或叠加；
 * hover 并发时 hover 高亮走 sky 层独立重绘，body 面积不得因此超过该上限
 */
export const BODY_AREA_RATIO_MAX = 1
