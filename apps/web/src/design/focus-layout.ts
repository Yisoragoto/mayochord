/**
 * 专注模式的页面布局（练习、跟拍弹进行共用）：
 * - 竖屏或屏幕够高：题目在上、键盘在下，键盘最高约 36% 屏幕高（tokens.css 的 --kb-max-h）；
 * - 横屏且不高（`split:`，平板横放、笔记本）：左边键盘和操作按钮、右边题目，整页不滚动。
 */
export const FOCUS_PAGE =
  'mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 split:h-dvh split:max-w-none split:px-6 split:[--kb-max-h:62dvh]';
export const FOCUS_BODY =
  'flex flex-1 flex-col split:grid split:min-h-0 split:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] split:items-center split:gap-8';
export const FOCUS_CUE =
  '@container flex flex-1 flex-col items-center justify-center py-6 split:order-2 split:h-full split:min-h-0 split:py-2 split:[--text-chord-stage:clamp(4rem,min(26cqi,24dvh),11rem)] split:[--text-chord-lg:clamp(2.5rem,min(13cqi,12dvh),5rem)]';
export const FOCUS_KEYS = 'space-y-3 split:order-1';
