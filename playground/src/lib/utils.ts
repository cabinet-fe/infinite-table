import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn 约定的类名合并工具：clsx 负责条件拼接，tailwind-merge 负责消解冲突的工具类
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
