/** 业务常量：预设地点、类别、图片限制 */

/** 预设地点（CLFP-USR-0006 用预设地点做文本筛选，同时允许补充其它地点） */
export const PRESET_LOCATIONS = [
  "图书馆",
  "第一食堂",
  "第二食堂",
  "教学楼",
  "实验楼",
  "体育馆",
  "操场",
  "学生宿舍区",
  "校医院",
  "校门口",
  "校车",
  "其它",
] as const;

/** 初始物品类别（CLFP-USR-0025 要求类别可在后台增删，这里是首次初始化的默认值） */
export const DEFAULT_CATEGORIES = [
  "卡证",
  "电子设备",
  "钥匙",
  "书籍",
  "服饰",
  "其它",
] as const;

/** 图片限制（CLFP-USR-0003、0004：不少于 1 张，最多 6 张） */
export const MIN_IMAGES = 1;
export const MAX_IMAGES = 6;
/** 单张图片大小上限（前端压缩后通常远小于此值） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const POST_TYPE_LABEL = {
  LOST: "寻物启事",
  FOUND: "拾物信息",
} as const;

export const POST_STATUS_LABEL = {
  OPEN: "寻找中",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
} as const;

export const POST_STATUS_STYLE = {
  OPEN: "bg-sky-50 text-sky-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  CLOSED: "bg-slate-100 text-slate-600",
} as const;
