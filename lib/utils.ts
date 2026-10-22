import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function detectSource(id: string): string {
  if (id.startsWith('greenhouse_')) return 'Greenhouse ATS';
  if (id.startsWith('lever_')) return 'Lever ATS';
  if (id.startsWith('ashby_')) return 'Ashby ATS';
  if (id.startsWith('freehire_')) return 'FreeHire ATS';
  if (id.startsWith('arbeitnow_')) return 'Arbeitnow';
  if (id.startsWith('internshala_')) return 'Internshala';
  if (id.startsWith('remoteok_')) return 'RemoteOK';
  if (id.startsWith('remotive_')) return 'Remotive';
  if (id.startsWith('eval_') || id.startsWith('manual_')) return 'Evaluated';
  return 'JSearch';
}
